from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from services import ingestion

router = APIRouter(tags=["news"])

ALLOWED_CATEGORIES = {"celebrity", "tech", "government", "sports"}


@router.get("/news")
async def list_stories(
    category: Optional[str] = Query(default=None),
    limit: Optional[int] = Query(default=None, ge=1, le=200),
) -> dict:
    if category and category not in ALLOWED_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown category '{category}'. Allowed: {sorted(ALLOWED_CATEGORIES)}",
        )

    # Always kick off background ingestion if today's batch is missing.
    if not ingestion.get_today_payload():
        await ingestion.ensure_today_ingested(background=True)

    # Fall back to the most recent successful batch so a transient
    # provider outage never leaves the feed empty.
    payload = ingestion.get_latest_payload()
    if not payload:
        return {"date": "", "totalCount": 0, "stories": [], "isStale": False}

    stories = payload.get("stories", [])
    if category:
        stories = [s for s in stories if s.get("category") == category]
    if limit:
        stories = stories[:limit]

    return {
        "date": payload.get("date", ""),
        "totalCount": len(stories),
        "stories": stories,
        "isStale": bool(payload.get("isStale", False)),
        "asOfDate": payload.get("asOfDate", payload.get("date", "")),
    }


@router.get("/news/{article_id}")
async def get_story(article_id: str) -> dict:
    story = ingestion.get_article(article_id)
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")
    return story
