"""Daily ingestion orchestration.

Fetches news from NewsMesh, enriches with Claude, and stores in cache
under news:YYYY-MM-DD plus a flat per-article index.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta
from typing import Any, Optional

from services import cache, enrichment, news_fetcher

log = logging.getLogger("marktr.ingestion")

PER_CATEGORY = 10
STATUS_KEY = "ingestion:status"
NEWS_RETENTION_DAYS = 7
ARTICLE_RETENTION_DAYS = 14
_status_lock = asyncio.Lock()


def _today() -> str:
    return date.today().isoformat()


def news_key(day: str) -> str:
    return f"news:{day}"


def article_key(article_id: str) -> str:
    return f"article:{article_id}"


def get_status() -> dict[str, Any]:
    return cache.get(STATUS_KEY) or {
        "state": "idle",
    }


def _set_status(status: dict[str, Any]) -> None:
    cache.set(STATUS_KEY, status)


async def ensure_today_ingested(*, background: bool = True) -> None:
    """Ensure today's news batch is cached, ingesting in the background if not."""
    if cache.get(news_key(_today())):
        log.info("Today's news already cached")
        return
    status = get_status()
    if status.get("state") == "running" and status.get("date") == _today():
        log.info("Ingestion already running for today")
        return
    if background:
        asyncio.create_task(run_ingestion())
    else:
        await run_ingestion()


async def run_ingestion() -> dict[str, Any]:
    """Run the full ingestion pipeline. Safe to call concurrently."""
    async with _status_lock:
        today = _today()
        existing = get_status()
        if existing.get("state") == "running" and existing.get("date") == today:
            return existing

        status: dict[str, Any] = {
            "date": today,
            "state": "running",
            "storyCount": 0,
            "startedAt": datetime.utcnow().isoformat() + "Z",
        }
        _set_status(status)

    try:
        log.info("Ingestion starting for %s", today)
        raw = await news_fetcher.fetch_all_categories(per_category=PER_CATEGORY)
        log.info("Fetched %d raw articles", len(raw))

        enriched = await enrichment.enrich_all(raw) if raw else []

        cache.set(news_key(today), {
            "date": today,
            "totalCount": len(enriched),
            "stories": enriched,
        })
        for story in enriched:
            aid = story.get("articleId")
            if aid:
                cache.set(article_key(aid), story)

        status = {
            "date": today,
            "state": "success",
            "storyCount": len(enriched),
            "startedAt": status["startedAt"],
            "finishedAt": datetime.utcnow().isoformat() + "Z",
        }
        _set_status(status)
        log.info("Ingestion finished: %d stories", len(enriched))
        try:
            cleanup_old_cache()
        except Exception as exc:  # noqa: BLE001
            log.warning("Cache cleanup after ingestion failed: %s", exc)
        return status
    except Exception as exc:  # noqa: BLE001
        log.exception("Ingestion failed: %s", exc)
        status = {
            "date": _today(),
            "state": "error",
            "storyCount": 0,
            "startedAt": status.get("startedAt") if isinstance(status, dict) else None,
            "finishedAt": datetime.utcnow().isoformat() + "Z",
            "message": str(exc),
        }
        _set_status(status)
        return status


def get_today_payload() -> Optional[dict[str, Any]]:
    return cache.get(news_key(_today()))


def get_latest_payload(max_lookback_days: int = NEWS_RETENTION_DAYS) -> Optional[dict[str, Any]]:
    """Return today's payload if present, else the most recent cached batch.

    Falls back up to ``max_lookback_days`` so that a transient provider
    outage doesn't leave the feed empty.
    """
    today = date.today()
    for offset in range(max_lookback_days + 1):
        day = (today - timedelta(days=offset)).isoformat()
        payload = cache.get(news_key(day))
        if payload:
            if offset > 0:
                payload = {**payload, "isStale": True, "asOfDate": day}
            return payload
    return None


def get_article(article_id: str) -> Optional[dict[str, Any]]:
    return cache.get(article_key(article_id))


def cleanup_old_cache() -> dict[str, int]:
    """Delete cached news/article keys older than the retention window."""
    today = date.today()
    keep_news_dates = {
        (today - timedelta(days=i)).isoformat()
        for i in range(NEWS_RETENTION_DAYS + 1)
    }

    deleted_news = 0
    for key in cache.list_keys("news:"):
        day = key.split(":", 1)[1] if ":" in key else ""
        if day and day not in keep_news_dates:
            cache.delete(key)
            deleted_news += 1

    valid_article_ids: set[str] = set()
    for day in keep_news_dates:
        payload = cache.get(news_key(day))
        if payload:
            for s in payload.get("stories", []):
                aid = s.get("articleId")
                if aid:
                    valid_article_ids.add(aid)

    deleted_articles = 0
    for key in cache.list_keys("article:"):
        aid = key.split(":", 1)[1] if ":" in key else ""
        if aid and aid not in valid_article_ids:
            cache.delete(key)
            deleted_articles += 1

    log.info(
        "Cache cleanup: removed %d news entries, %d article entries",
        deleted_news,
        deleted_articles,
    )
    return {"news": deleted_news, "articles": deleted_articles}
