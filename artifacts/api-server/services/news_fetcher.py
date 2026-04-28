"""NewsMesh API client.

Marktr's editorial categories map to NewsMesh categories as follows:
  celebrity  -> entertainment  (Claude further splits into celebrity / entertainment)
  tech       -> technology
  government -> politics
  sports     -> sports
  business   -> business
  science    -> science

The 'entertainment' Marktr category is populated by Claude at enrichment time —
stories fetched under 'celebrity' are reclassified as either 'celebrity' (person-
focused) or 'entertainment' (movie/show/event-focused) based on content.

Free tier: 25 requests/day, max 10 articles per request, 24h freshness delay.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx

log = logging.getLogger("marktr.newsmesh")

NEWSMESH_BASE = "https://api.newsmesh.co/v1"

CATEGORY_MAP: dict[str, str] = {
    "celebrity": "entertainment",
    "tech": "technology",
    "government": "politics",
    "sports": "sports",
    "business": "business",
    "science": "science",
}

ALL_CATEGORIES: list[str] = ["celebrity", "tech", "government", "sports", "business", "science"]


class NewsmeshError(RuntimeError):
    pass


async def fetch_category(
    marktr_category: str,
    *,
    limit: int = 10,
    country: str = "us",
) -> list[dict[str, Any]]:
    """Fetch the latest articles for a Marktr category.

    Returns a list of normalized article dicts with our own canonical fields.
    """
    api_key = os.environ.get("NEWSMESH_API_KEY")
    if not api_key:
        raise NewsmeshError("NEWSMESH_API_KEY is not set")

    nm_category = CATEGORY_MAP.get(marktr_category)
    if not nm_category:
        raise NewsmeshError(f"Unknown category: {marktr_category}")

    params = {
        "apiKey": api_key,
        "category": nm_category,
        "country": country,
        "limit": min(limit, 10),
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(f"{NEWSMESH_BASE}/latest", params=params)
        if resp.status_code >= 400:
            log.error(
                "NewsMesh /latest %s -> %s: %s",
                marktr_category,
                resp.status_code,
                resp.text[:300],
            )
            raise NewsmeshError(
                f"NewsMesh /latest failed ({resp.status_code})"
            )
        payload = resp.json()

    raw_articles = payload.get("articles") or payload.get("data") or []
    return [_normalize(a, marktr_category) for a in raw_articles if a]


def _normalize(article: dict[str, Any], marktr_category: str) -> dict[str, Any]:
    """Normalize a NewsMesh article to our internal shape."""
    article_id = (
        article.get("id")
        or article.get("article_id")
        or article.get("uuid")
        or article.get("link")
        or article.get("url")
        or ""
    )
    return {
        "articleId": str(article_id),
        "title": (article.get("title") or "").strip(),
        "description": (article.get("description") or article.get("summary") or "").strip(),
        "link": article.get("link") or article.get("url") or "",
        "mediaUrl": article.get("image") or article.get("image_url") or article.get("media_url"),
        "publishedDate": article.get("published_at")
        or article.get("publishedAt")
        or article.get("pub_date")
        or "",
        "source": _extract_source(article),
        "category": marktr_category,
    }


def _extract_source(article: dict[str, Any]) -> str:
    src = article.get("source")
    if isinstance(src, dict):
        return src.get("name") or src.get("id") or ""
    if isinstance(src, str):
        return src
    return article.get("publisher") or ""


async def fetch_all_categories(per_category: int = 10) -> list[dict[str, Any]]:
    """Fetch articles for every Marktr category sequentially.

    NewsMesh enforces a strict per-second rate limit, so we space out
    requests with a small delay rather than firing them in parallel.
    Errors per-category are swallowed so a single failure doesn't break
    ingestion for the whole day.
    """
    import asyncio

    results: list[list[dict[str, Any]]] = []
    for idx, cat in enumerate(ALL_CATEGORIES):
        if idx > 0:
            await asyncio.sleep(1.5)
        try:
            results.append(await fetch_category(cat, limit=per_category))
        except Exception as exc:  # noqa: BLE001
            log.exception("Failed to fetch category %s: %s", cat, exc)
            results.append([])

    flattened: list[dict[str, Any]] = []
    seen: set[str] = set()
    for batch in results:
        for art in batch:
            aid = art.get("articleId") or art.get("link")
            if not aid or aid in seen:
                continue
            seen.add(aid)
            flattened.append(art)
    return flattened


__all__ = ["fetch_category", "fetch_all_categories", "ALL_CATEGORIES", "NewsmeshError"]
