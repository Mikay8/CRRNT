"""Story routes — personalized feed, detail, save/unsave, breaking news, search."""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from pydantic import BaseModel

from services import db, personalization
from services.auth_middleware import get_current_user, get_current_user_optional

log = logging.getLogger("crrnt.stories")
router = APIRouter(prefix="/api/stories", tags=["stories"])

ALLOWED_CATEGORIES = {
    "celebrity", "tech", "government", "sports",
    "business", "science", "entertainment",
}


# ── Daily feed ────────────────────────────────────────────────────────────────

@router.get("/daily")
async def daily_feed(
    category: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    if category and category not in ALLOWED_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Unknown category '{category}'")

    tier = user.get("tier", "free")
    prefs = db.get_preferences(user["id"])

    stories = db.get_stories_for_feed()

    # Filter by category first if requested
    if category:
        stories = [s for s in stories if s.get("category") == category]

    # Paid story content never sent to free users
    if tier != "paid":
        stories = [s for s in stories if s.get("tier") == "free"]

    ranked = personalization.personalize_feed(stories, prefs, tier)

    # Strip paid content from free users (belt-and-suspenders)
    if tier != "paid":
        ranked = [s for s in ranked if s.get("tier") == "free"]

    return {
        "tier": tier,
        "totalCount": len(ranked),
        "stories": ranked,
    }


# ── Breaking news ─────────────────────────────────────────────────────────────

@router.get("/breaking")
async def breaking_news(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    card = db.get_active_breaking_news()
    return {"breaking": card}


# ── Saved stories ─────────────────────────────────────────────────────────────

@router.get("/saved")
async def get_saved(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    saved = db.get_saved_stories(user["id"])
    return {"totalCount": len(saved), "stories": saved}


# ── Search ────────────────────────────────────────────────────────────────────

@router.get("/search")
async def search(
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(default=20, ge=1, le=100),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    tier = user.get("tier", "free")
    stories = db.get_stories_for_feed()
    if tier != "paid":
        stories = [s for s in stories if s.get("tier") == "free"]

    needle = q.strip().lower()
    results = [
        s for s in stories
        if needle in " ".join(filter(None, [
            s.get("title"), s.get("summary"), s.get("one_liner"),
            s.get("wallet_impact"), s.get("stock_note"), s.get("category"),
        ])).lower()
    ]
    return {"query": q, "totalCount": len(results), "stories": results[:limit]}


# ── Story detail ──────────────────────────────────────────────────────────────

@router.get("/{story_id}")
async def get_story(
    story_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    story = db.get_story(story_id)
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")

    # Gate paid content
    if story.get("tier") == "paid" and user.get("tier") != "paid":
        raise HTTPException(
            status_code=403,
            detail="This story requires a CRRNT Pro subscription",
        )

    return story


# ── Save / unsave ─────────────────────────────────────────────────────────────

@router.post("/{story_id}/save", status_code=201)
async def save_story(
    story_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    story = db.get_story(story_id)
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")
    if story.get("tier") == "paid" and user.get("tier") != "paid":
        raise HTTPException(status_code=403, detail="Cannot save paid story on free tier")
    result = db.save_story(user["id"], story_id)
    return {"message": "Story saved", "saved": result}


@router.delete("/{story_id}/save")
async def unsave_story(
    story_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, str]:
    db.unsave_story(user["id"], story_id)
    return {"message": "Story removed from saved"}


# ── Audio ─────────────────────────────────────────────────────────────────────

@router.get("/{story_id}/audio")
async def get_story_audio(
    story_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
) -> Response:
    story = db.get_story(story_id)
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")
    if story.get("tier") == "paid" and user.get("tier") != "paid":
        raise HTTPException(status_code=403, detail="Requires Pro subscription")

    audio_bytes = db.get_audio(story_id)
    if not audio_bytes:
        raise HTTPException(status_code=404, detail="Audio not available for this story")

    total = len(audio_bytes)
    range_header = request.headers.get("range")

    if range_header:
        try:
            units, _, ranges = range_header.partition("=")
            if units.strip().lower() != "bytes" or not ranges:
                raise ValueError("bad range unit")
            raw_start, _, raw_end = ranges.partition("-")
            start = int(raw_start) if raw_start.strip() else 0
            end = int(raw_end) if raw_end.strip() else total - 1
            start = max(0, min(start, total - 1))
            end = max(start, min(end, total - 1))
        except ValueError:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{total}"})

        chunk = audio_bytes[start : end + 1]
        return Response(
            content=chunk,
            status_code=206,
            media_type="audio/mpeg",
            headers={
                "Accept-Ranges": "bytes",
                "Content-Range": f"bytes {start}-{end}/{total}",
                "Content-Length": str(len(chunk)),
            },
        )

    return Response(
        content=audio_bytes,
        media_type="audio/mpeg",
        headers={"Accept-Ranges": "bytes", "Content-Length": str(total)},
    )
