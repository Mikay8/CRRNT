from __future__ import annotations

import base64
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from services import ingestion

router = APIRouter(tags=["news"])

ALLOWED_CATEGORIES = {"celebrity", "tech", "government", "sports", "business", "science", "entertainment"}


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


@router.get("/news/{article_id}/audio")
async def get_story_audio(article_id: str, request: Request) -> Response:
    """Serve pre-generated MP3 audio with full HTTP range-request support.

    iOS AVPlayer (used by react-native-track-player under the hood) always
    sends a Range probe on its first request to extract ID3 duration metadata.
    Without a proper 206 Partial Content response the player cannot determine
    the track duration, the progress bar stays frozen at 0, and seeking breaks.
    """
    from services import cache as cache_svc
    audio_b64 = cache_svc.get(f"audio:{article_id}")
    if not audio_b64 or not isinstance(audio_b64, str):
        raise HTTPException(status_code=404, detail="Audio not available for this story")
    try:
        audio_bytes = base64.b64decode(audio_b64)
    except Exception:
        raise HTTPException(status_code=500, detail="Audio data corrupted")

    total = len(audio_bytes)
    range_header = request.headers.get("range")

    if range_header:
        # Parse "Range: bytes=<start>-<end>"
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
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(total),
        },
    )


@router.get("/news/{article_id}")
async def get_story(article_id: str) -> dict:
    story = ingestion.get_article(article_id)
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")
    return story


@router.get("/search")
async def search_stories(
    q: str = Query(..., min_length=1, max_length=200, description="Search query"),
    limit: int = Query(default=20, ge=1, le=100),
) -> dict:
    """Full-text search across all fields of today's cached stories."""
    payload = ingestion.get_latest_payload()
    if not payload:
        return {"query": q, "totalCount": 0, "stories": []}

    needle = q.strip().lower()
    results = []
    for s in payload.get("stories", []):
        haystack = " ".join(filter(None, [
            s.get("title"),
            s.get("description"),
            s.get("storySummary"),
            s.get("insight"),
            s.get("walletImpact"),
            s.get("source"),
            s.get("ticker"),
            s.get("companyName"),
            s.get("category"),
        ])).lower()
        if needle in haystack:
            results.append(s)

    return {
        "query": q,
        "totalCount": len(results),
        "stories": results[:limit],
    }
