"""Ingestion configuration — persisted to Postgres (primary) and JSON file (fallback).

Config shape:
  {
    "candidate_multiplier": 3,
    "categories": {
      "celebrity":   {"enabled": true, "count": 10},
      "tech":        {"enabled": true, "count": 10},
      "government":  {"enabled": true, "count": 10},
      "sports":      {"enabled": true, "count": 10},
      "business":    {"enabled": true, "count": 10},
      "science":     {"enabled": true, "count": 10},
      "world":       {"enabled": true, "count": 10},
      "health":      {"enabled": true, "count": 10},
    }
  }

candidate_multiplier is the single global knob for the ranking
candidate pool: pool per category = published count x multiplier.
It is clamped to 1-6 (pool max 60 at the 10-story count cap), so it
bounds ranking tokens per run while still giving ranking a choice.


Postgres is the primary store so settings survive redeployments. The local file
is kept as a write-through cache for fast reads and offline fallback.
"""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

log = logging.getLogger("crrnt.ingest_config")

_CONFIG_PATH = Path(__file__).parent.parent / "ingest_config.json"
_DB_KEY = "ingest_config"
_lock = asyncio.Lock()

ALL_CATEGORIES = ["celebrity", "tech", "government", "sports", "business", "science", "world", "health"]

_DEFAULT_CANDIDATE_MULTIPLIER = 3
_MAX_CANDIDATE_MULTIPLIER = 6

_DEFAULTS: dict[str, Any] = {
    "candidate_multiplier": _DEFAULT_CANDIDATE_MULTIPLIER,
    "categories": {cat: {"enabled": True, "count": 10} for cat in ALL_CATEGORIES},
}


def _backfill(data: dict[str, Any]) -> dict[str, Any]:
    # Drop keys left over from the APITube fetch modes.
    data.pop("mode", None)
    data.pop("trending_count", None)
    # Old configs have no multiplier: default to 3x, preserving the
    # behaviour before the multiplier was configurable.
    try:
        multiplier = int(data.get("candidate_multiplier", _DEFAULT_CANDIDATE_MULTIPLIER))
    except (TypeError, ValueError):
        multiplier = _DEFAULT_CANDIDATE_MULTIPLIER
    data["candidate_multiplier"] = max(1, min(_MAX_CANDIDATE_MULTIPLIER, multiplier))
    data.setdefault("categories", {})
    for cat in ALL_CATEGORIES:
        data["categories"].setdefault(cat, {"enabled": True, "count": 10})
    return data


async def _load() -> dict[str, Any]:
    # 1. Try Postgres first
    try:
        from services import db
        stored = await db.get_app_setting(_DB_KEY)
        if stored and isinstance(stored, dict):
            return _backfill(stored)
    except Exception as exc:
        log.warning("Could not load ingest config from DB: %s", exc)

    # 2. Fall back to local file
    try:
        if _CONFIG_PATH.exists():
            data = json.loads(_CONFIG_PATH.read_text())
            return _backfill(data)
    except Exception as exc:
        log.warning("Could not load ingest config from file: %s", exc)

    return json.loads(json.dumps(_DEFAULTS))


async def get() -> dict[str, Any]:
    async with _lock:
        return await _load()


async def save(cfg: dict[str, Any]) -> None:
    async with _lock:
        # Primary: Postgres
        try:
            from services import db
            await db.set_app_setting(_DB_KEY, cfg)
        except Exception as exc:
            log.warning("Could not save ingest config to DB: %s", exc)

        # Write-through: local file
        try:
            _CONFIG_PATH.write_text(json.dumps(cfg, indent=2))
        except Exception as exc:
            log.warning("Could not save ingest config to file: %s", exc)

        log.info("Ingestion config saved")


async def get_run_params() -> dict[str, Any]:
    """Returns kwargs ready to pass to ingestion.run_ingestion()."""
    cfg = await get()

    from services import app_settings
    feeds = await app_settings.get_rss_feeds()

    per_category_map = {
        cat: v.get("count", 10)
        for cat, v in cfg["categories"].items()
        if v.get("enabled", True)
    }
    multiplier = cfg.get("candidate_multiplier", _DEFAULT_CANDIDATE_MULTIPLIER)
    candidate_map = {
        cat: count * multiplier for cat, count in per_category_map.items()
    }
    return {
        "per_category_map": per_category_map,
        "candidate_map": candidate_map,
        "feeds": feeds,
    }
