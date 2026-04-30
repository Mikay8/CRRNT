"""Daily ingestion orchestration.

Fetches news from NewsMesh, enriches with Claude + X API, and stores in cache
under news:YYYY-MM-DD plus a flat per-article index.
Sends Expo push notification on successful completion.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta
from typing import Any, Optional

from services import cache, config as config_service, enrichment, news_fetcher, push

log = logging.getLogger("marktr.ingestion")

_DEFAULT_PER_CATEGORY = 10
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
    return cache.get(STATUS_KEY) or {"state": "idle"}


def _set_status(status: dict[str, Any]) -> None:
    cache.set(STATUS_KEY, status)


async def ensure_today_ingested(*, background: bool = True) -> None:
    """Ensure today's news batch is cached, ingesting in the background if not."""
    payload = cache.get(news_key(_today()))
    if payload and payload.get("stories"):
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

        cfg = config_service.get_config()
        per_category = int(cfg.get("perCategory", _DEFAULT_PER_CATEGORY))

        status: dict[str, Any] = {
            "date": today,
            "state": "running",
            "storyCount": 0,
            "perCategory": per_category,
            "startedAt": datetime.utcnow().isoformat() + "Z",
        }
        _set_status(status)

    try:
        log.info("Ingestion starting for %s (perCategory=%d)", today, per_category)
        raw = await news_fetcher.fetch_all_categories(per_category=per_category)
        log.info("Fetched %d raw articles", len(raw))

        enriched = await enrichment.enrich_all(raw) if raw else []

        if enriched:
            existing_payload = cache.get(news_key(today)) or {}
            existing_stories = existing_payload.get("stories", [])
            existing_ids = {s.get("articleId") for s in existing_stories if s.get("articleId")}
            new_stories = [s for s in enriched if s.get("articleId") not in existing_ids]
            merged = existing_stories + new_stories
            cache.set(news_key(today), {
                "date": today,
                "totalCount": len(merged),
                "stories": merged,
            })
            for story in new_stories:
                aid = story.get("articleId")
                if aid:
                    cache.set(article_key(aid), story)
        else:
            log.info("Ingestion produced 0 stories — preserving existing cache if present")

        status = {
            "date": today,
            "state": "success" if enriched else "empty",
            "storyCount": len(enriched),
            "perCategory": per_category,
            "startedAt": status["startedAt"],
            "finishedAt": datetime.utcnow().isoformat() + "Z",
        }
        _set_status(status)
        log.info("Ingestion finished: %d stories", len(enriched))

        try:
            cleanup_old_cache()
        except Exception as exc:  # noqa: BLE001
            log.info("Cache cleanup after ingestion failed: %s", exc)

        try:
            await push.send_push(
                "Updated News",
                f"{len(enriched)} fresh stories are ready for you.",
            )
        except Exception as exc:  # noqa: BLE001
            log.info("Push notification after ingestion failed: %s", exc)

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
    """Return all stories from the past max_lookback_days, newest-day-first.

    Stories older than NEWS_RETENTION_DAYS are automatically purged by
    cleanup_old_cache(), so this naturally respects the 7-day window.
    """
    today = date.today()
    today_str = today.isoformat()
    all_stories: list[dict[str, Any]] = []
    most_recent_date: Optional[str] = None
    seen_ids: set[str] = set()

    for offset in range(max_lookback_days + 1):
        day = (today - timedelta(days=offset)).isoformat()
        payload = cache.get(news_key(day))
        if payload and payload.get("stories"):
            if most_recent_date is None:
                most_recent_date = day
            for story in payload["stories"]:
                aid = story.get("articleId")
                if aid and aid in seen_ids:
                    continue
                if aid:
                    seen_ids.add(aid)
                all_stories.append(story)

    if not all_stories:
        return None

    is_stale = most_recent_date != today_str
    result: dict[str, Any] = {
        "date": most_recent_date,
        "totalCount": len(all_stories),
        "stories": all_stories,
        "isStale": is_stale,
    }
    if is_stale:
        result["asOfDate"] = most_recent_date
    return result


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


def delete_all_stories() -> dict[str, int]:
    """Delete all story-related cache entries (news + articles). Config and tokens preserved."""
    deleted_news = 0
    for key in cache.list_keys("news:"):
        cache.delete(key)
        deleted_news += 1

    deleted_articles = 0
    for key in cache.list_keys("article:"):
        cache.delete(key)
        deleted_articles += 1

    log.info("Admin: deleted %d news + %d article cache entries", deleted_news, deleted_articles)
    return {"news": deleted_news, "articles": deleted_articles}


def get_cache_stats() -> dict[str, int]:
    news_count = len(cache.list_keys("news:"))
    articles_count = len(cache.list_keys("article:"))
    stocks_count = len(cache.list_keys("stock:"))
    push_tokens = push.token_count()
    return {
        "stories": articles_count,
        "newsBatches": news_count,
        "articles": articles_count,
        "stocks": stocks_count,
        "pushTokens": push_tokens,
    }
