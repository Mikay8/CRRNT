"""Fish Audio TTS service.

Generates per-user story audio on first play request.
MP3 bytes are cached in the user_story_audio Postgres table.
Audio is personalized when the user has onboarding preferences on file,
generic otherwise.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Optional

import httpx

log = logging.getLogger("crrnt.fish_audio")

FISH_AUDIO_URL = "https://api.fish.audio/v1/tts"
MAX_CONCURRENCY = 2


def build_full_audio_text(
    story: dict[str, Any],
    personalized_text: Optional[str] = None,
    include_wallet: bool = False,
) -> str:
    """Build full story audio text for per-user generation.

    personalized_text: if provided, replaces generic life_impact.
    include_wallet: True for paid users (wallet_impact + one_liner section).
    """
    parts: list[str] = []
    title = (story.get("title") or "").strip()
    if title:
        parts.append(title + ".")
    summary = (story.get("summary") or "").strip()
    if summary:
        parts.append("[break]" + summary)

    if personalized_text and personalized_text.strip():
        parts.append("[break] Based on your profile. " + personalized_text.strip())
    else:
        life = (story.get("life_impact") or "").strip()
        if life:
            parts.append("[break] Here's how it affects you. " + life)

    if include_wallet:
        insight = (story.get("one_liner") or "").strip()
        wallet = (story.get("wallet_impact") or "").strip()
        wallet_line = " ".join(filter(None, [insight, wallet]))
        if wallet_line:
            parts.append("[break] How does this affect your wallet? " + wallet_line)

    people_say = (story.get("people_say") or "").strip()
    if people_say:
        parts.append("[break] What people are saying. " + people_say)
    return " ".join(parts)




async def synthesize_for_user(
    story: dict[str, Any],
    story_id: str,
    user_id: str,
    personalized_text: Optional[str] = None,
    include_wallet: bool = False,
) -> Optional[bytes]:
    """Generate full per-user audio, cache in user_story_audio, return MP3 bytes."""
    from services import db as db_svc

    api_key = os.environ.get("FISH_AUDIO_API_KEY")
    if not api_key:
        log.warning("FISH_AUDIO_API_KEY not set — skipping audio for user %s story %s", user_id, story_id)
        return None

    text = build_full_audio_text(story, personalized_text=personalized_text, include_wallet=include_wallet)
    if not text.strip():
        return None

    voice_id = os.environ.get("FISH_AUDIO_VOICE_ID")
    payload: dict[str, Any] = {
        "text": text,
        "format": "mp3",
        "mp3_bitrate": 128,
        "normalize": True,
        "temperature": 0.7,
        "top_p": 0.7,
        "prosody": {"speed": 1, "normalize_loudness": True},
        "latency": "normal",
        "chunk_length": 300,
    }
    if voice_id:
        payload["reference_id"] = voice_id

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                FISH_AUDIO_URL,
                headers={
                    "model": "s2-pro",
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            resp.raise_for_status()
            audio_bytes = resp.content
    except Exception as exc:
        log.warning("synthesize_for_user failed story=%s: %s", story_id, exc)
        return None

    try:
        await db_svc.store_user_audio(user_id, story_id, audio_bytes)
    except Exception as exc:
        log.warning("Failed to store user audio story=%s: %s", story_id, exc)

    return audio_bytes
