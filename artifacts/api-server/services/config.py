"""Runtime configuration stored in Replit KV.

Currently supports:
  perCategory (int): number of stories fetched per category during ingestion.
"""
from __future__ import annotations

from services import cache

CONFIG_KEY = "config:ingestion"

_DEFAULTS: dict = {
    "perCategory": 10,
}


def get_config() -> dict:
    stored = cache.get(CONFIG_KEY) or {}
    return {**_DEFAULTS, **stored}


def set_config(updates: dict) -> dict:
    current = get_config()
    merged = {**current, **updates}
    # Clamp perCategory to valid range
    if "perCategory" in merged:
        merged["perCategory"] = max(1, min(25, int(merged["perCategory"])))
    cache.set(CONFIG_KEY, merged)
    return merged
