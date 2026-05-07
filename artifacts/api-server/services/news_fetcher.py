"""NewsMesh API client.

CRRNT's editorial categories map to NewsMesh categories as follows:
  celebrity  -> entertainment  (Claude further splits into celebrity / entertainment)
  tech       -> technology
  government -> politics
  sports     -> sports
  business   -> business
  science    -> science

The 'entertainment' CRRNT category is populated by Claude at enrichment time —
stories fetched under 'celebrity' are reclassified as either 'celebrity' (person-
focused) or 'entertainment' (movie/show/event-focused) based on content.

Free tier: 25 requests/day, max 10 articles per request, 24h freshness delay.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx

log = logging.getLogger("crrnt.newsmesh")

NEWSMESH_BASE = "https://api.newsmesh.co/v1"

CATEGORY_MAP: dict[str, str] = {
    "celebrity": "entertainment",
    "tech": "technology",
    "government": "politics",
    "sports": "sports",
    "business": "business",
    "science": "science",
}

ALL_CATEGORIES: list[str] = [
    "celebrity",
    "tech",
    "government",
    "sports",
    "business",
    "science",
]

# Maps category names returned by /v1/trending to our internal categories.
# Unmapped values fall back to "government" (catch-all for general news).
TRENDING_CATEGORY_MAP: dict[str, str] = {
    "politics": "government",
    "technology": "tech",
    "entertainment": "celebrity",  # enrichment refines to celebrity/entertainment
    "sports": "sports",
    "business": "business",
    "science": "science",
    "health": "science",
    "world": "government",
    "national": "government",
    "general": "government",
}


class NewsmeshError(RuntimeError):
    pass


async def fetch_category(
    crrnt_category: str,
    *,
    limit: int = 10,
    country: str = "us",
) -> list[dict[str, Any]]:
    """Fetch the latest articles for a CRRNT category.

    Returns a list of normalized article dicts with our own canonical fields.
    """
    api_key = os.environ.get("NEWSMESH_API_KEY")
    if not api_key:
        raise NewsmeshError("NEWSMESH_API_KEY is not set")

    nm_category = CATEGORY_MAP.get(crrnt_category)
    if not nm_category:
        raise NewsmeshError(f"Unknown category: {crrnt_category}")

    params = {
        "apiKey": api_key,
        "category": nm_category,
        "country": country,
        "limit": min(limit, 10),
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(f"{NEWSMESH_BASE}/latest", params=params)
        if resp.status_code >= 400:
            log.info(
                "NewsMesh /latest %s -> %s: %s",
                crrnt_category,
                resp.status_code,
                resp.text[:300],
            )
            raise NewsmeshError(f"NewsMesh /latest failed ({resp.status_code})")
        payload = resp.json()

    raw_articles = payload.get("articles") or payload.get("data") or []
    normalized = [_normalize(a, crrnt_category) for a in raw_articles if a]
    log.info(
        "NewsMesh: %d article(s) fetched for category '%s'",
        len(normalized),
        crrnt_category,
    )
    return normalized


def _normalize(article: dict[str, Any], crrnt_category: str) -> dict[str, Any]:
    """Normalize a NewsMesh article to our internal shape."""
    article_id = (
        article.get("id")
        or article.get("article_id")
        or article.get("uuid")
        or article.get("link")
        or article.get("url")
        or ""
    )
    def _normalize_list(value: Any) -> list[str]:
        if isinstance(value, list):
            return [str(item) for item in value if isinstance(item, str)]
        if isinstance(value, str):
            return [value]
        return []

    return {
        "articleId": str(article_id),
        "title": (article.get("title") or "").strip(),
        "description": (
            article.get("description") or article.get("summary") or ""
        ).strip(),
        "link": article.get("link") or article.get("url") or "",
        "mediaUrl": article.get("image")
        or article.get("image_url")
        or article.get("media_url"),
        "publishedDate": article.get("published_date")
        or article.get("published_at")
        or article.get("publishedAt")
        or article.get("pub_date")
        or "",
        "source": _extract_source(article),
        "category": crrnt_category,
        "topics": _normalize_list(article.get("topics")),
        "people": _normalize_list(article.get("people")),
        "authors": _normalize_list(article.get("author") or article.get("authors")),
    }


def _extract_source(article: dict[str, Any]) -> str:
    src = article.get("source")
    if isinstance(src, dict):
        return src.get("name") or src.get("id") or ""
    if isinstance(src, str):
        return src
    return article.get("publisher") or ""


async def fetch_all_categories(
    categories: list[str], per_category: int = 10
) -> list[dict[str, Any]]:
    """Fetch articles for the specified CRRNT categories sequentially.

    NewsMesh enforces a strict per-second rate limit, so we space out
    requests with a small delay rather than firing them in parallel.
    Errors per-category are swallowed so a single failure doesn't break
    ingestion for the whole day.
    """
    import asyncio

    results: list[list[dict[str, Any]]] = []
    for idx, cat in enumerate(categories):
        if idx > 0:
            await asyncio.sleep(1.0)
        try:
            results.append(await fetch_category(cat, limit=per_category))
        except Exception as exc:  # noqa: BLE001
            # log.exception("Failed to fetch category %s: %s", cat, exc)
            log.info("Failed to fetch category %s: %s", cat, exc)
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
    log.info(
        "NewsMesh: all categories complete — %d unique articles total", len(flattened)
    )
    return flattened


async def fetch_trending(limit: int = 25) -> list[dict[str, Any]]:
    """Fetch trending articles from NewsMesh /v1/trending.

    The trending endpoint returns articles across all categories without a
    category filter.  Each article's 'category' field is mapped from the
    external name (e.g. 'politics') to our internal name (e.g. 'government')
    via TRENDING_CATEGORY_MAP before normalization.
    """
    api_key = os.environ.get("NEWSMESH_API_KEY")
    if not api_key:
        raise NewsmeshError("NEWSMESH_API_KEY is not set")

    params = {
        "apiKey": api_key,
        "limit": min(limit, 25),
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(f"{NEWSMESH_BASE}/trending", params=params)
        if resp.status_code >= 400:
            log.info(
                "NewsMesh /trending -> %s: %s",
                resp.status_code,
                resp.text[:300],
            )
            raise NewsmeshError(f"NewsMesh /trending failed ({resp.status_code})")
        payload = resp.json()

    raw_articles = payload.get("data") or payload.get("articles") or []
    normalized = []
    for a in raw_articles:
        if not a:
            continue
        external_cat = (a.get("category") or "").strip().lower()
        internal_cat = TRENDING_CATEGORY_MAP.get(external_cat, "government")
        normalized.append(_normalize(a, internal_cat))

    log.info("NewsMesh: %d trending article(s) fetched", len(normalized))
    return normalized


__all__ = ["fetch_category", "fetch_all_categories", "fetch_trending", "ALL_CATEGORIES", "TRENDING_CATEGORY_MAP", "NewsmeshError"]
