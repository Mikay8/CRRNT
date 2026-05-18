"""Cached accessors for app_settings stored in Supabase.

Settings are cached in-process with a 5-minute TTL so hot paths (the
feed endpoint, personalization) don't round-trip to Supabase on every request.
The cache is invalidated immediately after an admin save.
"""
from __future__ import annotations

import logging
import time
from typing import Any

log = logging.getLogger("crrnt.app_settings")

_FEED_LIMITS_KEY = "feed_limits"
_STORY_EXPIRY_KEY = "story_expiry"
_ADMIN_EMAILS_KEY = "admin_emails"
_TTL = 300.0  # seconds

_DEFAULTS: dict[str, Any] = {
    _FEED_LIMITS_KEY: {"free": 5, "paid": 15},
    _STORY_EXPIRY_KEY: {"days": 7, "extension_days": 30},
    _ADMIN_EMAILS_KEY: {"emails": []},
}

_cache: dict[str, Any] = {}
_cache_ts: dict[str, float] = {}


def _get(key: str) -> dict:
    now = time.monotonic()
    if key in _cache and now - _cache_ts.get(key, 0) < _TTL:
        return _cache[key]
    try:
        from services import db
        val = db.get_app_setting(key)
        if val and isinstance(val, dict):
            _cache[key] = val
            _cache_ts[key] = now
            return val
    except Exception as exc:
        log.warning("app_settings._get(%s) failed: %s", key, exc)
    return _cache.get(key, _DEFAULTS[key])


def _save(key: str, value: dict) -> None:
    try:
        from services import db
        db.set_app_setting(key, value)
    except Exception as exc:
        log.warning("app_settings._save(%s) failed: %s", key, exc)
    _cache[key] = value
    _cache_ts[key] = time.monotonic()


def get_feed_limits() -> dict[str, int]:
    return _get(_FEED_LIMITS_KEY)


def get_story_expiry() -> dict[str, int]:
    return _get(_STORY_EXPIRY_KEY)


def save_feed_limits(free: int, paid: int) -> None:
    _save(_FEED_LIMITS_KEY, {"free": free, "paid": paid})
    log.info("Feed limits saved: free=%d paid=%d", free, paid)


def save_story_expiry(days: int, extension_days: int) -> None:
    _save(_STORY_EXPIRY_KEY, {"days": days, "extension_days": extension_days})
    log.info("Story expiry saved: days=%d extension_days=%d", days, extension_days)


def get_admin_emails() -> list[str]:
    return _get(_ADMIN_EMAILS_KEY).get("emails", [])


def save_admin_emails(emails: list[str]) -> None:
    _save(_ADMIN_EMAILS_KEY, {"emails": emails})
    log.info("Admin emails saved: %s", emails)
