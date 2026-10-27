"""Cached accessors for app_settings stored in Postgres.

Settings are cached in-process with a 5-minute TTL so hot paths (the
feed endpoint, personalization) don't round-trip to the DB on every request.
The cache is invalidated immediately after an admin save.
"""
from __future__ import annotations

import copy
import logging
import time
from typing import Any

from services import rss

log = logging.getLogger("crrnt.app_settings")

_FEED_LIMITS_KEY = "feed_limits"
_STORY_EXPIRY_KEY = "story_expiry"
_ADMIN_EMAILS_KEY = "admin_emails"
_SCHEDULE_KEY = "schedule_times"
_DISABLED_FEEDS_KEY = "disabled_feeds"  # legacy, read once to seed _RSS_FEEDS_KEY
_RSS_FEEDS_KEY = "rss_feeds"
_BREAKING_STYLE_KEY = "breaking_style"
_TTL = 300.0  # seconds

_DEFAULTS: dict[str, Any] = {
    _FEED_LIMITS_KEY: {"daily": 15},
    _STORY_EXPIRY_KEY: {"days": 7, "extension_days": 30},
    _ADMIN_EMAILS_KEY: {"emails": []},
    _SCHEDULE_KEY: {"ingest_hour": 8, "ingest_minute": 0, "cleanup_hour": 3, "cleanup_minute": 0},
    # mode: "alternate" (flip Stop/Extra on every breaking send),
    # "stop" (always "Stop the presses!"), "extra" (always "Extra! Extra!").
    # last_hook tracks the alternate flip ("stop" | "extra" | None).
    _BREAKING_STYLE_KEY: {"mode": "alternate", "last_hook": None},
    _DISABLED_FEEDS_KEY: {"urls": []},
    # Empty until an admin first saves; get_rss_feeds() seeds it from
    # rss.DEFAULT_FEEDS on read.
    _RSS_FEEDS_KEY: {},
}

_cache: dict[str, Any] = {}
_cache_ts: dict[str, float] = {}


async def _get(key: str) -> dict:
    now = time.monotonic()
    if key in _cache and now - _cache_ts.get(key, 0) < _TTL:
        return _cache[key]
    try:
        from services import db
        val = await db.get_app_setting(key)
        if val and isinstance(val, dict):
            _cache[key] = val
            _cache_ts[key] = now
            return val
    except Exception as exc:
        log.warning("app_settings._get(%s) failed: %s", key, exc)
    return _cache.get(key, _DEFAULTS[key])


async def _save(key: str, value: dict) -> None:
    try:
        from services import db
        await db.set_app_setting(key, value)
    except Exception as exc:
        log.warning("app_settings._save(%s) failed: %s", key, exc)
    _cache[key] = value
    _cache_ts[key] = time.monotonic()


async def get_feed_limits() -> dict[str, int]:
    return await _get(_FEED_LIMITS_KEY)


async def get_story_expiry() -> dict[str, int]:
    return await _get(_STORY_EXPIRY_KEY)


async def save_feed_limits(daily: int) -> None:
    await _save(_FEED_LIMITS_KEY, {"daily": daily})
    log.info("Feed limits saved: daily=%d", daily)


async def save_story_expiry(days: int, extension_days: int) -> None:
    await _save(_STORY_EXPIRY_KEY, {"days": days, "extension_days": extension_days})
    log.info("Story expiry saved: days=%d extension_days=%d", days, extension_days)


async def get_admin_emails() -> list[str]:
    val = await _get(_ADMIN_EMAILS_KEY)
    return val.get("emails", [])


async def save_admin_emails(emails: list[str]) -> None:
    await _save(_ADMIN_EMAILS_KEY, {"emails": emails})
    log.info("Admin emails saved: %s", emails)


async def get_schedule_times() -> dict[str, int]:
    return await _get(_SCHEDULE_KEY)


async def save_schedule_times(ingest_hour: int, ingest_minute: int, cleanup_hour: int, cleanup_minute: int) -> None:
    await _save(_SCHEDULE_KEY, {
        "ingest_hour": ingest_hour,
        "ingest_minute": ingest_minute,
        "cleanup_hour": cleanup_hour,
        "cleanup_minute": cleanup_minute,
    })
    log.info("Schedule saved: ingestion=%02d:%02d ET cleanup=%02d:%02d ET", ingest_hour, ingest_minute, cleanup_hour, cleanup_minute)


async def get_breaking_style() -> dict[str, Any]:
    val = await _get(_BREAKING_STYLE_KEY)
    mode = val.get("mode", "alternate")
    if mode not in ("alternate", "stop", "extra"):
        mode = "alternate"
    return {"mode": mode, "last_hook": val.get("last_hook")}


async def save_breaking_style(mode: str, last_hook: str | None = None) -> None:
    if mode not in ("alternate", "stop", "extra"):
        mode = "alternate"
    current = await _get(_BREAKING_STYLE_KEY)
    await _save(_BREAKING_STYLE_KEY, {
        "mode": mode,
        # A mode change keeps the last flip position unless the caller
        # supplies one (the alternate flip itself does).
        "last_hook": last_hook if last_hook is not None else current.get("last_hook"),
    })
    log.info("Breaking alert style saved: mode=%s", mode)


async def get_rss_feeds() -> dict[str, list[dict[str, Any]]]:
    """Admin-managed RSS feeds per category: {cat: [{name, url, enabled}]}.

    Until an admin saves a feed list, this falls back to rss.DEFAULT_FEEDS
    with any feeds switched off under the older disabled_feeds setting.
    Always returns a copy, so callers can edit it and pass it to
    save_rss_feeds().
    """
    val = await _get(_RSS_FEEDS_KEY)
    feeds = copy.deepcopy(val.get("categories") or {})
    if not feeds:
        disabled = set((await _get(_DISABLED_FEEDS_KEY)).get("urls", []))
        feeds = {
            cat: [{**f, "enabled": f["url"] not in disabled} for f in defaults]
            for cat, defaults in rss.DEFAULT_FEEDS.items()
        }
    for cat in rss.CATEGORIES:
        feeds.setdefault(cat, [])
    return feeds


async def save_rss_feeds(feeds: dict[str, list[dict[str, Any]]]) -> None:
    await _save(_RSS_FEEDS_KEY, {"categories": feeds})
    log.info(
        "RSS feeds saved: %s",
        {cat: sum(1 for f in fs if f.get("enabled", True)) for cat, fs in feeds.items()},
    )
