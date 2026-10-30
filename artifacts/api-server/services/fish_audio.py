"""Fish Audio TTS service.

Generates one shared MP3 per story at ingestion time and uploads it to
object storage (see services/audio_storage). Not personalized per user —
personalization is text-only (see routes/stories.py life-impact override).
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any, Optional

import httpx

log = logging.getLogger("crrnt.fish_audio")

FISH_AUDIO_URL = "https://api.fish.audio/v1/tts"

# A summary sentence is dropped from the audio script only when it
# substantially restates the title: at least 4 shared content words and
# at most 6 new ones. The bar is deliberately high so sentences that
# share words with the title but add a real detail survive.
_TITLE_REPEAT_SHARED_MIN = 4
_TITLE_REPEAT_NEW_MAX = 6

_STOPWORDS = frozenset(
    "a an the is are was were be been being it its this that these those "
    "to of in on for and or with by at as from has have had will would can "
    "could should about into over after before between he she they we you i "
    "his her their our your my me him them us so but not no just really very "
    "also than then there here when where who what which how all any some "
    "more most other own same too".split()
)


def _content_words(text: str) -> set[str]:
    """Lowercased content words: stopwords removed, lightly stemmed.

    Apostrophes are stripped so possessives match their base form on
    both sides (brazil's -> brazils, matching the title's brazils).
    """
    words: set[str] = set()
    for raw in re.findall(r"[a-z0-9']+", text.lower()):
        word = raw.replace("'", "")
        if not word or word in _STOPWORDS:
            continue
        if len(word) > 4 and word.endswith("ing"):
            word = word[:-3]
        elif len(word) > 3 and word.endswith("ed"):
            word = word[:-2]
        elif len(word) > 3 and word.endswith("es"):
            word = word[:-2]
        elif len(word) > 2 and word.endswith("s") and not word.endswith("ss"):
            word = word[:-1]
        words.add(word)
    return words


def strip_title_repeats(title: str, summary: str) -> str:
    """Drop summary sentences that merely restate the title.

    The title stays as the spoken anchor; only the summary is filtered.
    Never drops the only sentence, and if every sentence qualifies the
    original summary is returned unchanged, so the filter can never
    empty the story body.
    """
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", summary) if s.strip()]
    if len(sentences) <= 1:
        return summary
    title_words = _content_words(title)
    if not title_words:
        return summary
    kept: list[str] = []
    for sentence in sentences:
        words = _content_words(sentence)
        if not words:
            kept.append(sentence)
            continue
        shared = words & title_words
        new = words - title_words
        if len(shared) >= _TITLE_REPEAT_SHARED_MIN and len(new) <= _TITLE_REPEAT_NEW_MAX:
            continue
        kept.append(sentence)
    return " ".join(kept) if kept else summary


def build_full_audio_text(story: dict[str, Any]) -> str:
    """Build full story audio text from the story's own fields."""
    parts: list[str] = []
    title = (story.get("display_title") or story.get("title") or "").strip()
    if title:
        parts.append(title + ".")
    summary = (story.get("summary") or "").strip()
    if summary:
        parts.append("[break]" + strip_title_repeats(title, summary))

    life = (story.get("life_impact") or "").strip()
    if life:
        parts.append("[break] Here's how it affects you. " + life)

    wallet = (story.get("wallet_impact") or "").strip()
    if wallet:
        insight = (story.get("one_liner") or "").strip()
        wallet_line = " ".join(filter(None, [insight, wallet]))
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
