"""Ingestion configuration — persisted as JSON on disk.

Config shape:
  {
    "mode": "category" | "trending",
    "categories": {
      "celebrity":   {"enabled": true, "count": 10},
      "tech":        {"enabled": true, "count": 10},
      "government":  {"enabled": true, "count": 10},
      "sports":      {"enabled": true, "count": 10},
      "business":    {"enabled": true, "count": 10},
      "science":     {"enabled": true, "count": 10},
    },
    "trending_count": 25
  }
"""
from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any

log = logging.getLogger("crrnt.ingest_config")

_CONFIG_PATH = Path(__file__).parent.parent / "ingest_config.json"
_lock = threading.Lock()

ALL_CATEGORIES = ["celebrity", "tech", "government", "sports", "business", "science"]

_DEFAULTS: dict[str, Any] = {
    "mode": "category",
    "categories": {cat: {"enabled": True, "count": 10} for cat in ALL_CATEGORIES},
    "trending_count": 25,
}


def _load() -> dict[str, Any]:
    try:
        if _CONFIG_PATH.exists():
            data = json.loads(_CONFIG_PATH.read_text())
            # Backfill any missing categories
            for cat in ALL_CATEGORIES:
                data.setdefault("categories", {})
                data["categories"].setdefault(cat, {"enabled": True, "count": 10})
            return data
    except Exception as exc:
        log.warning("Could not load ingest config: %s", exc)
    return json.loads(json.dumps(_DEFAULTS))


def get() -> dict[str, Any]:
    with _lock:
        return _load()


def save(cfg: dict[str, Any]) -> None:
    with _lock:
        try:
            _CONFIG_PATH.write_text(json.dumps(cfg, indent=2))
            log.info("Ingestion config saved: mode=%s", cfg.get("mode"))
        except Exception as exc:
            log.warning("Could not save ingest config: %s", exc)


def get_run_params() -> dict[str, Any]:
    """Returns kwargs ready to pass to ingestion.run_ingestion()."""
    cfg = get()
    if cfg["mode"] == "trending":
        return {"mode": "trending", "trending_count": cfg.get("trending_count", 25)}
    enabled = [
        cat for cat, v in cfg["categories"].items() if v.get("enabled", True)
    ]
    per_category_map = {
        cat: v.get("count", 10)
        for cat, v in cfg["categories"].items()
        if v.get("enabled", True)
    }
    return {
        "mode": "category",
        "categories": enabled,
        "per_category_map": per_category_map,
    }
