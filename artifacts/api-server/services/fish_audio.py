"""Fish Audio TTS service.

Synthesizes stories at ingestion time and stores MP3 bytes in the KV cache
so clients can stream pre-generated audio rather than calling the API live.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import os
from typing import Any

import httpx

from services import cache

log = logging.getLogger("marktr.fish_audio")

FISH_AUDIO_URL = "https://api.fish.audio/v1/tts"
AUDIO_KEY_PREFIX = "audio:"
MAX_CONCURRENCY = 2


def audio_cache_key(article_id: str) -> str:
    return f"{AUDIO_KEY_PREFIX}{article_id}"


def build_audio_text(story: dict[str, Any]) -> str:
    parts: list[str] = []
    title = (story.get("title") or "").strip()
    if title:
        parts.append(title + ".")
    life_impact = (story.get("lifeImpact") or "").strip()
    if life_impact:
        parts.append("(break) Here's how it affects you. " + life_impact)
    insight = (story.get("insight") or "").strip()
    wallet_impact = (story.get("walletImpact") or "").strip()
    wallet_line = " ".join(filter(None, [insight, wallet_impact]))
    if wallet_line:
        parts.append("(break) Wallet impact. " + wallet_line)
    people_say = (story.get("peopleSay") or "").strip()
    if people_say:
        parts.append("(break) What people are saying. " + people_say)
    return " ".join(parts)


async def synthesize_story(story: dict[str, Any]) -> dict[str, Any]:
    """Synthesize audio for a story and cache the MP3 bytes. Returns story with audioUrl set."""
    api_key = os.environ.get("FISH_AUDIO_API_KEY")
    if not api_key:
        return story

    article_id = story.get("articleId")
    if not article_id:
        return story

    # Skip if already cached
    if cache.get(audio_cache_key(article_id)):
        story["audioUrl"] = f"/api/news/{article_id}/audio"
        return story

    text = build_audio_text(story)
    if not text.strip():
        return story

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                FISH_AUDIO_URL,
                headers={
                    "model": "s2-pro",
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "text": text,
                    "format": "mp3",
                    "mp3_bitrate": 128,
                    "normalize": True,
                    "temperature": 0.7,
                    "top_p": 0.7,
                    "prosody": {"speed": 1, "normalize_loudness": True},
                    "latency": "normal",
                    "chunk_length": 300,
                },
            )
            resp.raise_for_status()
            audio_bytes = resp.content
    except Exception as exc:  # noqa: BLE001
        log.info("Fish Audio synthesis failed for %s: %s", article_id, exc)
        return story

    audio_b64 = base64.b64encode(audio_bytes).decode("ascii")
    cache.set(audio_cache_key(article_id), audio_b64)
    story["audioUrl"] = f"/api/news/{article_id}/audio"
    log.info("Audio cached for %s (%d bytes)", article_id, len(audio_bytes))
    return story


def attach_audio_url(story: dict[str, Any]) -> dict[str, Any]:
    article_id = story.get("articleId")
    if not article_id:
        return story

    if cache.get(audio_cache_key(article_id)):
        story["audioUrl"] = f"/api/news/{article_id}/audio"
    return story


async def synthesize_all(stories: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Run TTS for all stories with bounded concurrency. No-ops when API key is absent."""
    api_key = os.environ.get("FISH_AUDIO_API_KEY")
    if not api_key:
        log.info("FISH_AUDIO_API_KEY not set — skipping TTS synthesis")
        return stories

    sem = asyncio.Semaphore(MAX_CONCURRENCY)

    async def _bounded(story: dict[str, Any]) -> dict[str, Any]:
        async with sem:
            return await synthesize_story(story)

    return list(await asyncio.gather(*[_bounded(s) for s in stories]))
