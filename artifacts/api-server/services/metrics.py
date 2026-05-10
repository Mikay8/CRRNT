"""In-memory per-endpoint API usage metrics.

Tracks: call count, error count, total latency (ms), last called timestamp.
Attached as ASGI middleware in main.py.
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict
from typing import Any

_lock = threading.Lock()

# { path: { method: { calls, errors, total_ms, last_ts, status_counts } } }
_data: dict[str, dict[str, dict[str, Any]]] = defaultdict(
    lambda: defaultdict(lambda: {
        "calls": 0,
        "errors": 0,
        "total_ms": 0.0,
        "last_ts": None,
        "status_counts": defaultdict(int),
    })
)

_SKIP_PREFIXES = ("/admin", "/_", "/static", "/favicon")


def record(method: str, path: str, status_code: int, elapsed_ms: float) -> None:
    for prefix in _SKIP_PREFIXES:
        if path.startswith(prefix):
            return
    with _lock:
        bucket = _data[path][method.upper()]
        bucket["calls"] += 1
        bucket["total_ms"] += elapsed_ms
        bucket["last_ts"] = time.strftime("%H:%M:%S")
        bucket["status_counts"][str(status_code)] += 1
        if status_code >= 400:
            bucket["errors"] += 1


def get_all() -> list[dict[str, Any]]:
    rows = []
    with _lock:
        for path, methods in _data.items():
            for method, b in methods.items():
                calls = b["calls"]
                avg_ms = round(b["total_ms"] / calls, 1) if calls else 0
                error_pct = round(b["errors"] / calls * 100, 1) if calls else 0
                rows.append({
                    "method": method,
                    "path": path,
                    "calls": calls,
                    "errors": b["errors"],
                    "error_pct": error_pct,
                    "avg_ms": avg_ms,
                    "last_ts": b["last_ts"] or "—",
                    "status_counts": dict(b["status_counts"]),
                })
    rows.sort(key=lambda r: r["calls"], reverse=True)
    return rows


def reset() -> None:
    with _lock:
        _data.clear()
