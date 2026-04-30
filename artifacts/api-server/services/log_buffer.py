"""In-memory circular log buffer used by the admin logs endpoint."""
from __future__ import annotations

import collections
import datetime
import logging
import threading
from typing import Any

_MAX_PER_SOURCE = 100
_lock = threading.Lock()
_buffers: dict[str, collections.deque] = collections.defaultdict(
    lambda: collections.deque(maxlen=_MAX_PER_SOURCE)
)


class _MemoryLogHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            ts = datetime.datetime.fromtimestamp(record.created).strftime("%H:%M:%S")
            entry: dict[str, Any] = {
                "ts": ts,
                "level": record.levelname,
                "msg": record.getMessage(),
            }
            with _lock:
                _buffers[record.name].appendleft(entry)
        except Exception:
            pass


handler = _MemoryLogHandler()
handler.setLevel(logging.DEBUG)


def get_logs() -> dict[str, list[dict[str, Any]]]:
    with _lock:
        return {source: list(buf) for source, buf in _buffers.items() if buf}
