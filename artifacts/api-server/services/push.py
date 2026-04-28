"""Expo Push Notification service.

Stores device push tokens in Replit KV and sends notifications via
the Expo Push API after ingestion completes.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from services import cache

log = logging.getLogger("marktr.push")

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
TOKENS_KEY = "push:tokens"


def get_tokens() -> list[str]:
    return cache.get(TOKENS_KEY) or []


def add_token(token: str) -> None:
    tokens = set(get_tokens())
    tokens.add(token)
    cache.set(TOKENS_KEY, sorted(tokens))
    log.info("Push token registered (total: %d)", len(tokens) + 1)


def remove_token(token: str) -> None:
    tokens = set(get_tokens())
    tokens.discard(token)
    cache.set(TOKENS_KEY, sorted(tokens))


def token_count() -> int:
    return len(get_tokens())


async def send_push(title: str, body: str, data: dict[str, Any] | None = None) -> None:
    """Send a push notification to all registered devices."""
    tokens = get_tokens()
    if not tokens:
        log.info("No push tokens registered — skipping notification")
        return

    messages = [
        {
            "to": token,
            "title": title,
            "body": body,
            "sound": "default",
            **({"data": data} if data else {}),
        }
        for token in tokens
    ]

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                EXPO_PUSH_URL,
                json=messages,
                headers={
                    "Accept": "application/json",
                    "Accept-Encoding": "gzip, deflate",
                    "Content-Type": "application/json",
                },
            )
            resp.raise_for_status()
            result = resp.json()
            log.info("Push sent to %d device(s): %s", len(tokens), result)
    except Exception as exc:  # noqa: BLE001
        log.warning("Push notification failed: %s", exc)
