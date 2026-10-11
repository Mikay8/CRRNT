"""In-memory sliding-window rate limiting, keyed by client IP.

State lives in this process, which is correct for the single api-server
replica on Railway. If the service is ever scaled to more replicas or uvicorn
workers, each one will enforce its own limit — move the counters to Postgres
or Redis at that point.
"""
from __future__ import annotations

import os
import time
from collections import deque
from typing import Optional

from fastapi import Request

# On Railway, request.client is the edge proxy, so every caller would share
# one bucket. The edge sets X-Real-IP to the caller's address. Only trust it
# when running on Railway, where the edge overwrites it — locally any client
# could send the header and pick its own bucket.
_ON_RAILWAY = bool(os.environ.get("RAILWAY_ENVIRONMENT_ID"))


def client_ip(request: Request) -> str:
    if _ON_RAILWAY:
        real_ip = request.headers.get("x-real-ip", "").strip()
        if real_ip:
            return real_ip
    return request.client.host if request.client else "unknown"


class SlidingWindowLimiter:
    """Allow at most `limit` hits per `window` seconds for each key."""

    def __init__(self, limit: int, window: float) -> None:
        self.limit = limit
        self.window = window
        self._hits: dict[str, deque[float]] = {}
        self._last_sweep = time.monotonic()

    def _bucket(self, key: str, now: float) -> Optional[deque[float]]:
        bucket = self._hits.get(key)
        if bucket is None:
            return None
        cutoff = now - self.window
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()
        if not bucket:
            del self._hits[key]
            return None
        return bucket

    def _sweep(self, now: float) -> None:
        # Drop idle keys so one-off visitors don't accumulate forever.
        if now - self._last_sweep < self.window:
            return
        self._last_sweep = now
        cutoff = now - self.window
        for key in [k for k, b in self._hits.items() if not b or b[-1] <= cutoff]:
            del self._hits[key]

    def retry_after(self, key: str) -> int:
        """Seconds until `key` may hit again; 0 if it's under the limit now."""
        now = time.monotonic()
        bucket = self._bucket(key, now)
        if bucket is None or len(bucket) < self.limit:
            return 0
        return max(1, int(bucket[0] + self.window - now) + 1)

    def record(self, key: str) -> None:
        now = time.monotonic()
        self._sweep(now)
        self._hits.setdefault(key, deque()).append(now)

    def reset(self, key: str) -> None:
        self._hits.pop(key, None)
