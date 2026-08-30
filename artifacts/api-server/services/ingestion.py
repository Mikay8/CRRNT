"""Ingestion orchestration — fetch, enrich, store in Postgres.

Pipeline:
  1. NewsMesh fetch (per category)
  2. Claude Pass 1 — summary, life_impact, wallet_impact, one_liner, stock_note
  3. X API + Claude Pass 2 — sentiment_label, sentiment_score, people_say
  4. Insert story row to Postgres (get UUID)
  5. Fish Audio TTS — upload, set tts_url
  6. Write ingestion_log row
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from services import app_settings, audio_storage, db, enrichment, fish_audio, news_fetcher

log = logging.getLogger("crrnt.ingestion")

ALL_CATEGORIES = news_fetcher.ALL_CATEGORIES
_DEFAULT_PER_CATEGORY = 10
_status_lock = asyncio.Lock()
_ingestion_status: dict[str, Any] = {"state": "idle"}


def get_status() -> dict[str, Any]:
    return _ingestion_status


def _set_status(s: dict[str, Any]) -> None:
    global _ingestion_status
    _ingestion_status = s


# ── Expiry helper ─────────────────────────────────────────────────────────────

def _parse_datetime(value: Optional[str]) -> Optional[datetime]:
    """Parse an ISO datetime string from an upstream API into a real datetime.

    asyncpg requires an actual datetime/date object for TIMESTAMPTZ columns —
    unlike the old Supabase REST client, it will not coerce a string.
    """
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


async def _expires_at(published_at: Optional[datetime], days: Optional[int] = None) -> datetime:
    if days is None:
        days = (await app_settings.get_story_expiry())["days"]
    base = published_at or datetime.now(timezone.utc)
    return base + timedelta(days=days)


# ── Map enrichment output to a stories row ─────────────────────────────────────

async def _to_story_row(raw: dict[str, Any]) -> dict[str, Any]:
    """Convert enriched story dict to a stories table row."""
    ticker = raw.get("ticker")
    company = raw.get("companyName")
    stock_note_parts = [p for p in [ticker, f"({company})" if company else None] if p]
    stock_note = " ".join(stock_note_parts) if stock_note_parts else None

    pub = _parse_datetime(raw.get("publishedDate") or raw.get("published_at"))

    sentiment_label = raw.get("sentimentLabel") or raw.get("sentiment_label")
    sentiment_score = raw.get("sentimentScore") or raw.get("sentiment_score")
    if isinstance(sentiment_score, str):
        try:
            sentiment_score = float(sentiment_score)
        except ValueError:
            sentiment_score = None

    return {
        "external_id": raw.get("articleId") or raw.get("external_id"),
        "title": raw.get("title"),
        "category": raw.get("category"),
        "published_at": pub,
        "source_url": raw.get("link") or raw.get("source_url"),
        "media_url": raw.get("mediaUrl") or raw.get("media_url"),
        "summary": raw.get("storySummary") or raw.get("summary"),
        "life_impact": raw.get("lifeImpact") or raw.get("life_impact"),
        "wallet_impact": raw.get("walletImpact") or raw.get("wallet_impact"),
        "stock_note": stock_note,
        "one_liner": raw.get("insight") or raw.get("one_liner"),
        "sentiment_label": sentiment_label,
        "sentiment_score": sentiment_score,
        "people_say": raw.get("peopleSay") or raw.get("people_say"),
        "expires_at": await _expires_at(pub),
    }


# ── Main ingestion run ────────────────────────────────────────────────────────

async def run_ingestion(
    per_category: int = _DEFAULT_PER_CATEGORY,
    categories: Optional[list[str]] = None,
    mode: str = "category",
    per_category_map: Optional[dict[str, int]] = None,
    trending_count: int = 25,
) -> dict[str, Any]:
    """Full ingestion pipeline. Returns a status dict."""
    async with _status_lock:
        if _ingestion_status.get("state") == "running":
            return _ingestion_status
        _set_status({
            "state": "running",
            "startedAt": datetime.now(timezone.utc).isoformat(),
            "storyCount": 0,
        })

    started_at = datetime.now(timezone.utc)
    fetched_count = 0
    enriched_count = 0
    error_count = 0

    try:
        if mode == "trending":
            log.info("Ingestion starting (mode=trending, count=%d)", trending_count)
            raw = await news_fetcher.fetch_trending(limit=trending_count)
            for a in raw:
                a["_is_trending"] = True
        elif mode == "both":
            log.info("Ingestion starting (mode=both, trending=%d)", trending_count)
            trending_raw = await news_fetcher.fetch_trending(limit=trending_count)
            for a in trending_raw:
                a["_is_trending"] = True
            await asyncio.sleep(1.0)
            if per_category_map:
                cat_raw = await news_fetcher.fetch_categories_with_map(per_category_map)
            else:
                selected = categories or ALL_CATEGORIES
                cat_raw = await news_fetcher.fetch_all_categories(selected, per_category=per_category)
            for a in cat_raw:
                a["_is_trending"] = False
            # Dedup by articleId — trending wins if a story appears in both pulls
            seen: dict[str, Any] = {}
            for a in trending_raw + cat_raw:
                aid = a.get("articleId")
                key = aid if aid else id(a)
                if key not in seen:
                    seen[key] = a
            raw = list(seen.values())
        elif per_category_map:
            # Per-category counts — fetch each separately
            log.info("Ingestion starting (mode=category, per_category_map=%s)", per_category_map)
            raw = await news_fetcher.fetch_categories_with_map(per_category_map)
        else:
            selected = categories or ALL_CATEGORIES
            log.info("Ingestion starting (per_category=%d, categories=%s)", per_category, selected)
            raw = await news_fetcher.fetch_all_categories(selected, per_category=per_category)
        fetched_count = len(raw)
        log.info("Fetched %d raw articles", fetched_count)

        if not raw:
            _set_status({"state": "empty", "storyCount": 0, "startedAt": started_at.isoformat()})
            await _write_log(fetched_count, 0, 0, "partial", "No articles fetched")
            return _ingestion_status

        enriched = await enrichment.enrich_all(raw)
        log.info("Enriched %d stories", len(enriched))

        inserted_stories: list[dict] = []
        tts_count = 0
        for story in enriched:
            try:
                row = await _to_story_row(story)
                external_id = row.get("external_id")

                # Skip duplicates
                if external_id and await db.get_story_by_external_id(external_id):
                    log.info("Skipping duplicate: %s", external_id)
                    continue

                # Remove None external_id to avoid constraint errors
                if not external_id:
                    row.pop("external_id", None)

                inserted = await db.insert_story(row)
                enriched_count += 1
                inserted_stories.append({
                    "title": row.get("title"),
                    "category": row.get("category"),
                })

                try:
                    audio_bytes = await fish_audio.synthesize_for_story(inserted)
                    if audio_bytes:
                        s3_key = audio_storage.upload_story_audio(inserted["id"], audio_bytes)
                        if s3_key:
                            await db.update_story_tts_key(inserted["id"], s3_key)
                            tts_count += 1
                except Exception as exc:
                    log.warning("Audio generation failed for story %s: %s", inserted.get("id"), exc)

            except Exception as exc:
                log.exception("Failed to store story: %s", exc)
                error_count += 1

        log.info(
            "Ingestion done: fetched=%d enriched=%d errors=%d",
            fetched_count, enriched_count, error_count,
        )
        status_str = "success" if error_count == 0 else "partial"

        cleanup_result: dict = {"deleted": 0, "extended": 0}
        try:
            cleanup_result = await run_cleanup()
        except Exception as exc:
            log.warning("Post-ingestion cleanup failed: %s", exc)

        _set_status({
            "state": status_str,
            "storyCount": enriched_count,
            "insertedStories": inserted_stories,
            "cleanup": cleanup_result,
            "startedAt": started_at.isoformat(),
            "finishedAt": datetime.now(timezone.utc).isoformat(),
        })
        await _write_log(fetched_count, enriched_count, error_count, status_str, tts_generated=tts_count)

        try:
            from services import email_service
            await email_service.send_digest(stories=inserted_stories, cleanup=cleanup_result)
        except Exception as exc:
            log.warning("Digest email failed: %s", exc)

        return _ingestion_status

    except Exception as exc:
        log.exception("Ingestion pipeline failed: %s", exc)
        error_count += 1
        _set_status({
            "state": "error",
            "storyCount": enriched_count,
            "startedAt": started_at.isoformat(),
            "finishedAt": datetime.now(timezone.utc).isoformat(),
            "message": str(exc),
        })
        await _write_log(fetched_count, enriched_count, error_count, "failed", str(exc))
        return _ingestion_status


async def _write_log(
    fetched: int, enriched: int, errors: int,
    status: str, notes: Optional[str] = None, tts_generated: int = 0,
) -> None:
    try:
        await db.insert_ingestion_log({
            "stories_fetched": fetched,
            "stories_enriched": enriched,
            "tts_generated": tts_generated,
            "errors": errors,
            "status": status,
            "notes": notes,
        })
    except Exception as exc:
        log.warning("Failed to write ingestion log: %s", exc)


# ── Story expiry cleanup ──────────────────────────────────────────────────────

async def run_cleanup() -> dict[str, int]:
    """Delete expired stories unless saved; extend if saved."""
    expired = await db.get_expired_stories()
    deleted = 0
    extended = 0

    for row in expired:
        story_id = row["id"]
        save_count = await db.saved_story_count(story_id)
        if save_count == 0:
            if row.get("tts_url"):
                audio_storage.delete_story_audio(story_id)
            await db.delete_story(story_id)
            deleted += 1
        else:
            extension_days = (await app_settings.get_story_expiry())["extension_days"]
            await db.extend_story_expiry(story_id, days=extension_days)
            extended += 1

    log.info("Cleanup: deleted=%d extended=%d", deleted, extended)
    await _write_log(0, 0, 0, "success", f"Cleanup: deleted={deleted} extended={extended}")
    return {"deleted": deleted, "extended": extended}
