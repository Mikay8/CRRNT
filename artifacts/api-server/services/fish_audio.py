"""Fish Audio TTS service.

Generates one shared MP3 per story at ingestion time and uploads it to
object storage (see services/audio_storage). Not personalized per user —
personalization is text-only (see routes/stories.py life-impact override).
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx

log = logging.getLogger("crrnt.fish_audio")

FISH_AUDIO_URL = "https://api.fish.audio/v1/tts"


def build_full_audio_text(story: dict[str, Any]) -> str:
    """Build full story audio text from the story's own fields."""
    parts: list[str] = []
    title = (story.get("title") or "").strip()
    if title:
        parts.append(title + ".")
    summary = (story.get("summary") or "").strip()
    if summary:
        parts.append("[break]" + summary)

    life = (story.get("life_impact") or "").strip()
    if life:
        parts.append("[break] Here's how it affects you. " + life)

    insight = (story.get("one_liner") or "").strip()
    wallet = (story.get("wallet_impact") or "").strip()
    wallet_line = " ".join(filter(None, [insight, wallet]))
    if wallet_line:
        parts.append("[break] How does this affect your wallet? " + wallet_line)

    people_say = (story.get("people_say") or "").strip()
    if people_say:
        parts.append("[break] What people are saying. " + people_say)
    return " ".join(parts)


async def synthesize_for_story(story: dict[str, Any]) -> Optional[bytes]:
    """Generate MP3 bytes for a story via Fish Audio. Returns None on any failure."""
    api_key = os.environ.get("FISH_AUDIO_API_KEY")
    if not api_key:
        log.warning("FISH_AUDIO_API_KEY not set — skipping audio for story %s", story.get("id"))
        return None

    text = build_full_audio_text(story)
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
            return resp.content
    except Exception as exc:
        log.warning("synthesize_for_story failed story=%s: %s", story.get("id"), exc)
        return None
