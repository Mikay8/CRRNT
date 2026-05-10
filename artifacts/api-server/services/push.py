"""Expo Push Notification service.

Tokens are stored in the push_tokens Supabase table (TEXT rows).
Falls back gracefully if Supabase is not configured.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

log = logging.getLogger("crrnt.push")

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


def _db():
    from services import db
    return db.get_client()


def get_tokens() -> list[str]:
    try:
        result = _db().table("push_tokens").select("token").execute()
        return [r["token"] for r in (result.data or [])]
    except Exception as exc:
        log.warning("push.get_tokens failed: %s", exc)
        return []


def add_token(token: str) -> None:
    try:
        _db().table("push_tokens").upsert({"token": token}).execute()
        log.info("Push token registered: %s…", token[:20])
    except Exception as exc:
        log.warning("push.add_token failed: %s", exc)


def remove_token(token: str) -> None:
    try:
        _db().table("push_tokens").delete().eq("token", token).execute()
    except Exception as exc:
        log.warning("push.remove_token failed: %s", exc)


def token_count() -> int:
    try:
        result = _db().table("push_tokens").select("token", count="exact").execute()
        return result.count or 0
    except Exception:
        return 0


async def send_push(title: str, body: str, data: dict[str, Any] | None = None) -> None:
    tokens = get_tokens()
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
