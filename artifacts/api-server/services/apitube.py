"""APITube News API client — replaces NewsMesh.

CRRNT's editorial categories map to APITube's IPTC Media Topics category IDs:
  celebrity  -> medtop:20000505 (celebrity)
  tech       -> medtop:13000000 (science and technology)
  government -> medtop:11000000 (politics and government)
  sports     -> medtop:15000000 (sport)
  business   -> medtop:04000000 (economy, business and finance)
  science    -> medtop:13000000 (science and technology - same bucket as tech;
                IPTC has no separate top-level science/tech split. Overlap is
                fine since ingestion dedupes by articleId/link.)
  world      -> medtop:03000000,medtop:16000000,medtop:02000000 (disaster,
                accident and emergency incident + conflict, war and peace +
                crime, law and justice - combined into one CRRNT bucket for
                general hard-news events that don't fit any other category)
  health     -> medtop:07000000 (health)

Unlike NewsMesh, APITube returns the full article body (and a machine
summary, sentiment, keywords, source authority rank) in the same response —
no separate per-article fetch is needed.

Plan limits observed live: 10 requests/minute, 10 results per page max.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Optional

import httpx

log = logging.getLogger("crrnt.apitube")

APITUBE_BASE = "https://api.apitube.io/v1/news"
_MAX_PER_PAGE = 10  # plan limit

CATEGORY_MAP: dict[str, str] = {
    "celebrity": "medtop:20000505",
    "tech": "medtop:13000000",
    "government": "medtop:11000000",
    "sports": "medtop:15000000",
    "business": "medtop:04000000",
    "science": "medtop:13000000",
    "world": "medtop:03000000,medtop:16000000,medtop:02000000",
    "health": "medtop:07000000",
}

ALL_CATEGORIES: list[str] = [
    "celebrity",
    "tech",
    "government",
    "sports",
    "business",
    "science",
    "world",
    "health",
]


class ApitubeError(RuntimeError):
    pass


def _get_key() -> str:
    api_key = os.environ.get("APITUBE_API_KEY")
    if not api_key:
        raise ApitubeError("APITUBE_API_KEY is not set")
    return api_key


async def fetch_category(
    crrnt_category: str,
    *,
    limit: int = 10,
) -> list[dict[str, Any]]:
    """Fetch the latest articles for a CRRNT category."""
    api_key = _get_key()

    category_id = CATEGORY_MAP.get(crrnt_category)
    if not category_id:
        raise ApitubeError(f"Unknown category: {crrnt_category}")

    params = {
        "per_page": min(limit, _MAX_PER_PAGE),
        "language.code": "en",
        "category.id": category_id,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{APITUBE_BASE}/everything",
            params=params,
            headers={"X-API-Key": api_key},
        )
        if resp.status_code >= 400:
            log.info(
                "APITube /everything %s -> %s: %s",
                crrnt_category,
                resp.status_code,
                resp.text[:300],
            )
            raise ApitubeError(f"APITube /everything failed ({resp.status_code})")
        payload = resp.json()

    if payload.get("status") != "ok":
        log.info("APITube /everything %s -> not_ok: %s", crrnt_category, payload.get("errors"))
        return []

    raw_articles = payload.get("results") or []
    normalized = [_normalize(a, crrnt_category) for a in raw_articles if a]
    log.info(
        "APITube: %d article(s) fetched for category '%s'",
        len(normalized),
        crrnt_category,
    )
    return normalized


def _normalize_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if isinstance(item, str)]
    if isinstance(value, str):
        return [value]
    return []


def _normalize(article: dict[str, Any], crrnt_category: str) -> dict[str, Any]:
    """Normalize an APITube article to our internal shape.

    APITube returns full article text in `body` (plus a short `description`
    dek) — we prefer `body` for description so Claude Pass 1 has real
    substance to work with, not just a one-line teaser.
    """
    article_id = article.get("id") or article.get("href") or ""

    body = (article.get("body") or "").strip()
    dek = (article.get("description") or "").strip()
    description = body[:2000] if body else dek

    entities = article.get("entities") or []
    people = [
        e.get("name") for e in entities
        if isinstance(e, dict) and e.get("type") == "person" and e.get("name")
    ]
    categories = article.get("categories") or []
    topics = [
        c.get("name") for c in categories
        if isinstance(c, dict) and c.get("name")
    ]

    source = article.get("source") or {}
    source_name = source.get("domain") or source.get("id") or ""

    return {
        "articleId": str(article_id),
        "title": (article.get("title") or "").strip(),
        "description": description,
        "link": article.get("href") or "",
        "mediaUrl": article.get("image") or None,
        "publishedDate": article.get("published_at") or "",
        "source": str(source_name),
        "category": crrnt_category,
        "topics": _normalize_list(topics),
        "people": _normalize_list(people),
        "authors": _normalize_list((article.get("author") or {}).get("name")),
    }


async def fetch_all_categories(
    categories: list[str], per_category: int = 10
) -> list[dict[str, Any]]:
    """Fetch articles for the specified CRRNT categories sequentially.

    APITube enforces a 10 requests/minute plan limit, so we space out
    requests rather than firing them in parallel. Errors per-category are
    swallowed so a single failure doesn't break ingestion for the whole day.
    """
    results: list[list[dict[str, Any]]] = []
    for idx, cat in enumerate(categories):
        if idx > 0:
            await asyncio.sleep(6.0)
        try:
            results.append(await fetch_category(cat, limit=per_category))
        except Exception as exc:  # noqa: BLE001
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
        "APITube: all categories complete — %d unique articles total", len(flattened)
    )
    return flattened


async def fetch_trending(limit: int = 25) -> list[dict[str, Any]]:
    """Fetch top headlines across all categories from APITube /top-headlines.

    /top-headlines only returns high-authority sources (source.rank.opr >= 5),
    which is the closest equivalent to NewsMesh's trending feed. NOTE: the
    category.id filter on this endpoint currently 502s on APITube's side
    (confirmed live, filed as a known issue) — so this fetches unfiltered
    top headlines and infers each story's CRRNT category from its returned
    `categories` array instead of filtering server-side.
    """
    api_key = _get_key()

    params = {
        "per_page": min(limit, _MAX_PER_PAGE),
        "language.code": "en",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{APITUBE_BASE}/top-headlines",
            params=params,
            headers={"X-API-Key": api_key},
        )
        if resp.status_code >= 400:
            log.info(
                "APITube /top-headlines -> %s: %s",
                resp.status_code,
                resp.text[:300],
            )
            raise ApitubeError(f"APITube /top-headlines failed ({resp.status_code})")
        payload = resp.json()

    if payload.get("status") != "ok":
        log.info("APITube /top-headlines -> not_ok: %s", payload.get("errors"))
        return []

    raw_articles = payload.get("results") or []
    normalized = []
    for a in raw_articles:
        if not a:
            continue
        internal_cat = _infer_category(a)
        normalized.append(_normalize(a, internal_cat))

    log.info("APITube: %d trending article(s) fetched", len(normalized))
    return normalized


# Reverse lookup: IPTC top-level category name -> CRRNT category.
# Science and technology is checked as "tech" here (an arbitrary pick between
# tech/science, which share one IPTC bucket) purely so trending stories land
# somewhere specific rather than the "world" catch-all.
_IPTC_NAME_TO_CRRNT: dict[str, str] = {
    "celebrity": "celebrity",
    "science and technology": "tech",
    "politics and government": "government",
    "sport": "sports",
    "economy, business and finance": "business",
    "health": "health",
    "arts, culture, entertainment and media": "celebrity",
    "disaster, accident and emergency incident": "world",
    "conflict, war and peace": "world",
    "crime, law and justice": "world",
}


def _infer_category(article: dict[str, Any]) -> str:
    """Map an APITube article's categories array back to a CRRNT category."""
    names = [
        (c.get("name") or "").strip().lower()
        for c in (article.get("categories") or [])
        if isinstance(c, dict)
    ]
    for name in names:
        if name in _IPTC_NAME_TO_CRRNT:
            return _IPTC_NAME_TO_CRRNT[name]
    return "world"  # catch-all for anything not matching a specific bucket


async def fetch_categories_with_map(
    per_category_map: dict[str, int],
) -> list[dict[str, Any]]:
    """Fetch categories using individual per-category counts.

    per_category_map: { "celebrity": 5, "tech": 10, ... }
    Only categories in the map are fetched.
    """
    results: list[list[dict[str, Any]]] = []
    cats = list(per_category_map.items())
    for idx, (cat, count) in enumerate(cats):
        if idx > 0:
            await asyncio.sleep(6.0)
        try:
            results.append(await fetch_category(cat, limit=count))
        except Exception as exc:
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
    log.info("APITube: fetch_categories_with_map complete — %d unique articles", len(flattened))
    return flattened


__all__ = [
    "fetch_category",
    "fetch_all_categories",
    "fetch_categories_with_map",
    "fetch_trending",
    "ALL_CATEGORIES",
    "ApitubeError",
]
