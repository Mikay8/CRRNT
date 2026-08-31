"""Story routes — personalized feed, detail, save/unsave, breaking news, search."""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from services import app_settings, audio_storage, db, enrichment, personalization
from services.auth_middleware import get_current_user, get_current_user_optional

log = logging.getLogger("crrnt.stories")
router = APIRouter(prefix="/api/stories", tags=["stories"])

ALLOWED_CATEGORIES = {
    "celebrity", "tech", "government", "sports",
    "business", "science", "entertainment",
    "world", "health",
}


def _with_presigned_audio(story: dict[str, Any]) -> dict[str, Any]:
    """tts_url in the DB holds the S3 object key — swap it for a time-limited GET URL."""
    s3_key = story.get("tts_url")
    story["tts_url"] = audio_storage.presigned_audio_url(s3_key) if s3_key else None
    return story


# ── Daily feed ────────────────────────────────────────────────────────────────

@router.get("/daily")
async def daily_feed(
    category: Optional[str] = Query(default=None),
    user: Optional[dict] = Depends(get_current_user_optional),
) -> dict[str, Any]:
    if category and category not in ALLOWED_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Unknown category '{category}'")

    prefs = await db.get_preferences(user["id"]) if user else {}

    stories = await db.get_stories_for_feed()

    if category:
        stories = [s for s in stories if s.get("category") == category]

    ranked = await personalization.personalize_feed(stories, prefs, category=category)
    ranked = [_with_presigned_audio(s) for s in ranked]

    return {
        "totalCount": len(ranked),
        "stories": ranked,
    }


# ── Breaking news ─────────────────────────────────────────────────────────────

@router.get("/breaking")
async def breaking_news(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    card = await db.get_active_breaking_news()
    return {"breaking": card}


# ── Saved stories ─────────────────────────────────────────────────────────────

@router.get("/saved")
async def get_saved(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    saved = [_with_presigned_audio(s) for s in await db.get_saved_stories(user["id"])]
    return {"totalCount": len(saved), "stories": saved}


# ── Search ────────────────────────────────────────────────────────────────────

@router.get("/search")
async def search(
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(default=20, ge=1, le=100),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    stories = await db.get_stories_for_feed()

    needle = q.strip().lower()
    results = [
        s for s in stories
        if needle in " ".join(filter(None, [
            s.get("title"), s.get("summary"), s.get("one_liner"),
            s.get("wallet_impact"), s.get("stock_note"), s.get("category"),
        ])).lower()
    ]
    page = [_with_presigned_audio(s) for s in results[:limit]]
    return {"query": q, "totalCount": len(results), "stories": page}


# ── Story detail ──────────────────────────────────────────────────────────────

@router.get("/{story_id}")
async def get_story(
    story_id: str,
    user: Optional[dict] = Depends(get_current_user_optional),
) -> dict[str, Any]:
    story = await db.get_story(story_id)
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")

    personalized_text: Optional[str] = None
    if user:
        try:
            prefs = await db.get_preferences(user["id"])
            if prefs:
                cached = await db.get_personalization(user["id"], story_id)
                if cached:
                    personalized_text = cached["personalized_text"]
                    story["personalized_life_impact"] = personalized_text
                else:
                    text = await enrichment.personalize_life_impact(story, prefs)
                    if text:
                        try:
                            await db.store_personalization(user["id"], story_id, text)
                        except Exception as e:
                            log.warning("Failed to cache personalization for %s: %s", story_id, e)
                        personalized_text = text
                        story["personalized_life_impact"] = text
        except Exception as e:
            log.warning("Personalization block failed for story %s: %s", story_id, e)

    return _with_presigned_audio(story)


# ── Save / unsave ─────────────────────────────────────────────────────────────

@router.post("/{story_id}/save", status_code=201)
async def save_story(
    story_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    story = await db.get_story(story_id)
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")
    limits = await app_settings.get_feed_limits()
    if await db.count_saved_stories(user["id"]) >= limits["daily"]:
        raise HTTPException(status_code=403, detail="save_limit_reached")
    result = await db.save_story(user["id"], story_id)
    return {"message": "Story saved", "saved": result}


@router.delete("/{story_id}/save")
async def unsave_story(
    story_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, str]:
    await db.unsave_story(user["id"], story_id)
    return {"message": "Story removed from saved"}


# ── Audio ─────────────────────────────────────────────────────────────────────

@router.get("/{story_id}/audio")
async def get_story_audio(story_id: str) -> RedirectResponse:
    """Legacy fallback for old tts_url?token= links — redirects to a fresh
    presigned S3 URL. Audio itself is generated once at ingestion time
    (see services/ingestion.py), not on request."""
    story = await db.get_story(story_id)
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")

    s3_key = story.get("tts_url")
    if not s3_key:
        raise HTTPException(status_code=404, detail="Audio not available for this story")

    url = audio_storage.presigned_audio_url(s3_key)
    if not url:
        raise HTTPException(status_code=503, detail="Audio storage temporarily unavailable")

    return RedirectResponse(url)
