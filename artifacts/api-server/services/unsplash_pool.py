"""Unsplash image pool for story cards — free commercial images, no RSS publisher photos.

Design (goal: crrnt-images-from-free-commercial-sources-not-rss-feeds):
- The pool is per-category, generic and deliberately non-person: search terms
  avoid people, so a pool photo can never be a recognizable person
  illustrating a story about a different person.
- Unsplash API rules are followed exactly: hotlink images.unsplash.com URLs
  (never download/rehost), credit the photographer and Unsplash with
  ?utm_source=crrnt&utm_medium=referral links, and trigger each photo's
  download_location once it is actually assigned to a story.
- The pool fills lazily from ingestion (one search per category when the
  pool is low or stale), so the API key stays server-side and phones never
  call Unsplash. A cold fill of all 9 categories is 9 requests — inside
  even the demo tier (50 req/hr).
- Any Unsplash failure degrades to no pool image, never to a failed
  ingestion run: the app falls back to its bundled category art.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx

from services.db import get_pool

log = logging.getLogger("crrnt.unsplash")

UNSPLASH_API = "https://api.unsplash.com"

# Generic, non-person imagery per CRRNT category. Deliberately no people,
# no celebrities, no events where an identifiable individual could be read
# as illustrating a story about someone else.
CATEGORY_QUERIES: dict[str, str] = {
    "business": "city skyline business district",
    "tech": "computer technology workspace",
    "science": "science laboratory research",
    "sports": "stadium sports field",
    "health": "healthy lifestyle wellness",
    "government": "government building architecture",
    "world": "city street travel",
    "celebrity": "hollywood sign landmark",
    "entertainment": "cinema screen film",
}

_MIN_POOL = 5          # refill a category below this many images
_REFILL_AFTER_DAYS = 30  # or when its newest image is older than this
_SEARCH_PER_PAGE = 20


def _api_key() -> str:
    return os.environ.get("UNSPLASH_ACCESS_KEY", "")


def _headers() -> dict[str, str]:
    return {"Authorization": f"Client-ID {_api_key()}"}


async def search_photos(query: str, order_by: str = "relevant") -> list[dict[str, Any]]:
    """Search Unsplash; returns normalized pool rows (not yet stored)."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"{UNSPLASH_API}/search/photos",
            headers=_headers(),
            params={
                "query": query,
                "per_page": _SEARCH_PER_PAGE,
                "orientation": "landscape",
                "content_filter": "high",
                "order_by": order_by,
            },
        )
        resp.raise_for_status()
        data = resp.json()
    rows = []
    for item in data.get("results") or []:
        urls = item.get("urls") or {}
        user = item.get("user") or {}
        links = item.get("links") or {}
        image_url = urls.get("regular")
        if not image_url or not item.get("id"):
            continue
        rows.append({
            "unsplash_photo_id": item["id"],
            "image_url": image_url,
            "photographer_name": user.get("name") or "Unsplash",
            # Raw profile URL; the app appends ?utm_source=crrnt&utm_medium=referral at link time.
            "photographer_url": (user.get("links") or {}).get("html") or "https://unsplash.com/",
            "photo_url": links.get("html") or "",
            "download_location": links.get("download_location") or "",
        })
    return rows


async def ensure_pools(categories: set[str]) -> None:
    """Fill/refresh the pool for each category. Never raises."""
    if not categories:
        return
    if not _api_key():
        log.warning("Unsplash pool skipped — UNSPLASH_ACCESS_KEY not set (stories fall back to category art)")
        return
    for category in sorted(categories):
        query = CATEGORY_QUERIES.get(category)
        if not query:
            continue
        try:
            async with get_pool().acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT COUNT(*) AS n, MAX(created_at) AS newest FROM image_pool WHERE category = $1",
                    category,
                )
            count = row["n"] if row else 0
            newest = row["newest"] if row else None
            if newest is not None and newest.tzinfo is None:
                newest = newest.replace(tzinfo=timezone.utc)
            stale = newest is None or (
                datetime.now(timezone.utc) - newest
                > timedelta(days=_REFILL_AFTER_DAYS)
            )
            if count >= _MIN_POOL and not stale:
                continue
            order_by = "latest" if count >= _MIN_POOL else "relevant"
            photos = await search_photos(query, order_by=order_by)
            inserted = 0
            async with get_pool().acquire() as conn:
                for p in photos:
                    r = await conn.execute(
                        "INSERT INTO image_pool "
                        "(category, unsplash_photo_id, image_url, photographer_name, "
                        "photographer_url, photo_url, download_location) "
                        "VALUES ($1, $2, $3, $4, $5, $6, $7) "
                        "ON CONFLICT (unsplash_photo_id) DO NOTHING",
                        category, p["unsplash_photo_id"], p["image_url"],
                        p["photographer_name"], p["photographer_url"],
                        p["photo_url"], p["download_location"],
                    )
                    if r == "INSERT 0 1":
                        inserted += 1
            log.info("Unsplash pool %s: %d images (added %d)", category, count + inserted, inserted)
        except Exception as exc:
            log.warning("Unsplash pool fill failed for %s: %s", category, exc)


async def pick_for_story(category: Optional[str]) -> Optional[dict[str, Any]]:
    """Least-recently-used pool photo for a category. Does not mark it used;
    call mark_used() after the story actually inserts."""
    if not category:
        return None
    try:
        async with get_pool().acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id, image_url, photographer_name, photographer_url, "
                "photo_url, download_location FROM image_pool "
                "WHERE category = $1 ORDER BY last_used_at ASC NULLS FIRST LIMIT 1",
                category,
            )
        return dict(row) if row else None
    except Exception as exc:
        log.warning("Unsplash pool pick failed for %s: %s", category, exc)
        return None


async def mark_used(photo_id: Any) -> None:
    try:
        async with get_pool().acquire() as conn:
            await conn.execute(
                "UPDATE image_pool SET last_used_at = NOW() WHERE id = $1", photo_id
            )
    except Exception as exc:
        log.warning("Unsplash pool mark_used failed: %s", exc)


async def trigger_download(download_location: str) -> None:
    """Count the use with Unsplash (API guideline). Never raises."""
    if not download_location or not _api_key():
        return
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(download_location, headers=_headers())
            resp.raise_for_status()
    except Exception as exc:
        log.warning("Unsplash download trigger failed: %s", exc)
