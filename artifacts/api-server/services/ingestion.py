"""Ingestion orchestration — fetch, enrich, store in Postgres.

Pipeline:
  1. RSS fetch (per category, candidate pool = configured count x
     the global candidate_multiplier from ingest_config, default 3)
  2. Drop stale, in-batch duplicate, and already-stored articles
  3. Claude ranking — one batched call per category, keep only the
     configured top N per category (falls back to newest-first)
  4. Claude Pass 1 — summary, life_impact, wallet_impact, one_liner, stock_note
  5. Grok x_search Pass 2 — sentiment_label, sentiment_score, people_say, featured_posts
  6. Insert story row to Postgres (get UUID; the post-enrichment
     duplicate check stays as a safety net)
  7. Fish Audio TTS — upload, set tts_url
  8. Write ingestion_log row
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from services import app_settings, audio_storage, db, enrichment, fish_audio, ranking, rss

log = logging.getLogger("crrnt.ingestion")

ALL_CATEGORIES = rss.CATEGORIES
_DEFAULT_PER_CATEGORY = 10
# Fallback candidate-pool multiplier, used only by direct callers
# that do not pass candidate_map. Normal runs get candidate_map from
# ingest_config.get_run_params(), where the multiplier is a single
# global, admin-configurable setting (default 3, clamped 1-6).
_CANDIDATE_POOL_MULTIPLIER = 3
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


# Some feeds keep old evergreen items around for weeks, and the same wire
# story can appear in several feeds under different links. Drop anything
# older than this window and collapse same-title duplicates within a single
# fetch before spending Claude/Grok calls enriching junk.
_MAX_ARTICLE_AGE_DAYS = 3


def _filter_fresh_and_unique(articles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=_MAX_ARTICLE_AGE_DAYS)
    # Count exact-title occurrences first: the kept copy carries the
    # count as a corroboration signal for ranking, even though the
    # duplicate copies themselves are dropped here.
    title_counts: dict[str, int] = {}
    for a in articles:
        title_key = (a.get("title") or "").strip().lower()
        if title_key:
            title_counts[title_key] = title_counts.get(title_key, 0) + 1
    seen_titles: set[str] = set()
    kept: list[dict[str, Any]] = []
    for a in articles:
        title_key = (a.get("title") or "").strip().lower()
        if title_key and title_key in seen_titles:
            continue
        pub = _parse_datetime(a.get("publishedDate") or a.get("published_at"))
        if pub is not None and pub < cutoff:
            continue
        if title_key:
            seen_titles.add(title_key)
            a["corroboration"] = title_counts[title_key]
        kept.append(a)
    dropped = len(articles) - len(kept)
    if dropped:
        log.info("Filtered out %d stale/duplicate article(s) before enrichment", dropped)
    return kept


async def _filter_already_stored(articles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop items already in the DB, before paying for enrichment.

    Uses the same key as the post-enrichment duplicate check in
    run_ingestion (articleId, falling back to external_id). Items with
    no id are kept, matching that check's behavior. The
    post-enrichment check stays in place as a safety net for stories
    inserted between this filter and the insert.
    """
    kept: list[dict[str, Any]] = []
    for a in articles:
        external_id = a.get("articleId") or a.get("external_id")
        if external_id and await db.get_story_by_external_id(external_id):
            log.info("Skipping already-stored duplicate before enrichment: %s", external_id)
            continue
        kept.append(a)
    dropped = len(articles) - len(kept)
    if dropped:
        log.info("Filtered out %d already-stored duplicate(s) before enrichment", dropped)
    return kept


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
    if pub is None:
        # A NULL published_at silently excludes the row from every feed query
        # (`published_at >= $1` is never true against NULL) — fall back to now
        # rather than insert a story the feed can never surface.
        log.warning(
            "Missing/unparseable publishedDate for '%s' (raw=%r) — defaulting to now",
            raw.get("title", "")[:60],
            raw.get("publishedDate") or raw.get("published_at"),
        )
        pub = datetime.now(timezone.utc)

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
        "featured_posts": json.dumps(raw.get("featuredPosts") or raw.get("featured_posts") or []),
        "expires_at": await _expires_at(pub),
    }


# ── Main ingestion run ────────────────────────────────────────────────────────

async def run_ingestion(
    per_category: int = _DEFAULT_PER_CATEGORY,
    categories: Optional[list[str]] = None,
    per_category_map: Optional[dict[str, int]] = None,
    feeds: Optional[dict[str, list[dict[str, Any]]]] = None,
    ranking_enabled: bool = True,
    candidate_map: Optional[dict[str, int]] = None,
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
        cat_map = per_category_map or {
            cat: per_category for cat in (categories or ALL_CATEGORIES)
        }
        log.info("Ingestion starting (per_category_map=%s)", cat_map)
        # Fetch a wider candidate pool than the final count, then rank
        # down to it: ranking is only useful if there is a choice to
        # make, and only the winners are ever enriched.
        if candidate_map:
            pool_map = {
                cat: candidate_map.get(cat, count * _CANDIDATE_POOL_MULTIPLIER)
                for cat, count in cat_map.items()
            }
        else:
            pool_map = {
                cat: count * _CANDIDATE_POOL_MULTIPLIER for cat, count in cat_map.items()
            }
        log.info("Candidate pool map: %s", pool_map)
        raw = await rss.fetch_categories_with_map(pool_map, feeds=feeds)
        raw = _filter_fresh_and_unique(raw)
        fetched_count = len(raw)
        log.info("Fetched %d raw articles", fetched_count)

        if not raw:
            _set_status({"state": "empty", "storyCount": 0, "startedAt": started_at.isoformat()})
            await _write_log(fetched_count, 0, 0, "partial", "No articles fetched")
            return _ingestion_status

        raw = await _filter_already_stored(raw)
        if not raw:
            _set_status({"state": "empty", "storyCount": 0, "startedAt": started_at.isoformat()})
            await _write_log(fetched_count, 0, 0, "partial", "All fetched articles already stored")
            return _ingestion_status

        ranking_summary: dict[str, dict[str, int]] = {}
        if ranking_enabled:
            # Group by category in configured order; categories not in
            # cat_map (should not happen) pass through unranked.
            by_category: dict[str, list[dict[str, Any]]] = {cat: [] for cat in cat_map}
            unranked: list[dict[str, Any]] = []
            for a in raw:
                cat = a.get("category")
                if cat in by_category:
                    by_category[cat].append(a)
                else:
                    unranked.append(a)
            ranked = await ranking.rank_categories(by_category, cat_map)
            raw = [a for cat in cat_map for a in ranked.get(cat, [])] + unranked
            ranking_summary = {
                cat: {"candidates": len(by_category[cat]), "kept": len(ranked.get(cat, []))}
                for cat in cat_map
            }
            log.info("Ranking summary: %s", ranking_summary)

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
            "ranking": ranking_summary,
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
