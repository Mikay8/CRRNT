"""Expo Push Notification service.

Tokens are stored in the push_tokens Postgres table.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from services import db

log = logging.getLogger("crrnt.push")

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


async def get_tokens() -> list[str]:
    try:
        return await db.get_push_tokens()
    except Exception as exc:
        log.warning("push.get_tokens failed: %s", exc)
        return []


async def add_token(token: str) -> None:
    try:
        await db.add_push_token(token)
        log.info("Push token registered: %s…", token[:20])
    except Exception as exc:
        log.warning("push.add_token failed: %s", exc)


async def remove_token(token: str) -> None:
    try:
        await db.remove_push_token(token)
    except Exception as exc:
        log.warning("push.remove_token failed: %s", exc)


async def token_count() -> int:
    try:
        return await db.push_token_count()
    except Exception:
        return 0


async def send_push(title: str, body: str, data: dict[str, Any] | None = None) -> None:
    tokens = await get_tokens()
    if not tokens:
        log.info("No push tokens — skipping notification")
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
            log.info("Push sent to %d device(s)", len(tokens))
    except Exception as exc:
        log.info("Push notification failed: %s", exc)
