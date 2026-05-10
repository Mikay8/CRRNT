"""Fish Audio TTS service.

Synthesizes story audio at ingestion time.
MP3 bytes are stored in the story_audio Supabase table.
tts_url points to /api/stories/{story_id}/audio on our API.
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


def build_audio_text(story: dict[str, Any]) -> str:
    parts: list[str] = []
    title = (story.get("title") or "").strip()
    if title:
        parts.append(title + ".")
    summary = (story.get("storySummary") or story.get("summary") or "").strip()
    if summary:
        parts.append("(break) " + summary)
    life = (story.get("lifeImpact") or story.get("life_impact") or "").strip()
    if life:
        parts.append("(break) Here's how it affects you. " + life)
    insight = (story.get("insight") or story.get("one_liner") or "").strip()
    wallet = (story.get("walletImpact") or story.get("wallet_impact") or "").strip()
    wallet_line = " ".join(filter(None, [insight, wallet]))
    if wallet_line:
        parts.append("(break) How does this affect your wallet? " + wallet_line)
    people_say = (story.get("peopleSay") or story.get("people_say") or "").strip()
    if people_say:
        parts.append("(break) What people are saying. " + people_say)
    return " ".join(parts)


async def synthesize_and_store(story: dict[str, Any], story_id: str) -> Optional[str]:
    """Synthesize TTS, store bytes in Supabase, return tts_url or None on failure."""
    from services import db as db_svc

    api_key = os.environ.get("FISH_AUDIO_API_KEY")
    if not api_key:
        return None

    # Skip if already stored
    existing = db_svc.get_audio(story_id)
    if existing:
        return f"/api/stories/{story_id}/audio"

    text = build_audio_text(story)
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
        log.warning("Fish Audio synthesis failed for story %s: %s", story_id, exc)
        return None

    try:
        db_svc.store_audio(story_id, audio_bytes)
        log.info("Audio stored for story %s (%d bytes)", story_id, len(audio_bytes))
    except Exception as exc:
        log.warning("Failed to store audio for story %s: %s", story_id, exc)
        return None

    return f"/api/stories/{story_id}/audio"
