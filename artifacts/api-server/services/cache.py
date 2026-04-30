"""Replit DB-backed key/value cache with JSON serialization.

Falls back to an in-memory dict when REPLIT_DB_URL is not configured
(e.g. local CI). All values are JSON-encoded.
"""
from __future__ import annotations

import json
import logging
import os
import threading
from typing import Any, Optional
from urllib.parse import quote

import httpx

log = logging.getLogger("marktr.cache")

_db_url: Optional[str] = None
_memory: dict[str, str] = {}
_lock = threading.RLock()


def init() -> None:
    global _db_url
    _db_url = os.environ.get("REPLIT_DB_URL") or None
    if _db_url:
        log.info("Replit DB cache enabled")
    else:
        log.info("REPLIT_DB_URL not set — using in-memory cache only")


def _encoded_key(key: str) -> str:
    return quote(key, safe="")


def get(key: str) -> Optional[Any]:
    raw = _get_raw(key)
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        log.info("Failed to JSON-decode cached value for %s", key)
        return None


def set(key: str, value: Any) -> None:
    raw = json.dumps(value, default=str)
    _set_raw(key, raw)


def delete(key: str) -> None:
    if _db_url:
        try:
            httpx.delete(f"{_db_url}/{_encoded_key(key)}", timeout=10.0)
        except httpx.HTTPError as exc:
            log.info("Replit DB delete failed for %s: %s", key, exc)
    with _lock:
        _memory.pop(key, None)


def _get_raw(key: str) -> Optional[str]:
    if _db_url:
        try:
            resp = httpx.get(f"{_db_url}/{_encoded_key(key)}", timeout=10.0)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.text
        except httpx.HTTPError as exc:
            log.info("Replit DB get failed for %s: %s", key, exc)
    with _lock:
        return _memory.get(key)


def _set_raw(key: str, raw: str) -> None:
    if _db_url:
        try:
            resp = httpx.post(
                _db_url,
                content=f"{quote(key, safe='')}={quote(raw, safe='')}",
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=15.0,
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            log.info("Replit DB set failed for %s: %s", key, exc)
    with _lock:
        _memory[key] = raw


def list_keys(prefix: str = "") -> list[str]:
    """List keys matching the given prefix.

    Backed by Replit DB's `?prefix=` query when available; falls back to
    scanning the in-memory store.
    """
    if _db_url:
        try:
            resp = httpx.get(
                f"{_db_url}",
                params={"prefix": prefix, "encode": "true"},
                timeout=15.0,
            )
            resp.raise_for_status()
            text = resp.text.strip()
            if not text:
                return []
            from urllib.parse import unquote
            return [unquote(k) for k in text.splitlines() if k]
        except httpx.HTTPError as exc:
            log.info("Replit DB list failed for prefix %s: %s", prefix, exc)
    with _lock:
        return [k for k in _memory.keys() if k.startswith(prefix)]
