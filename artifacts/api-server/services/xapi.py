"""GetXAPI client — fetches recent tweets related to a news story.

Runs separate targeted searches per entity (ticker, company, people, topics)
concurrently, deduplicates by tweet ID, and returns the merged set for Claude
to filter for relevance.

Correct endpoint: GET /twitter/tweet/advanced_search?q=...&product=Latest
Response: { tweets: [...], tweet_count, has_more, next_cursor }
Each tweet has inline `author` object with userName, name, profilePicture, etc.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Any, Optional

import httpx

log = logging.getLogger("marktr.xapi")

XAPI_BASE = "https://api.getxapi.com"
MAX_RESULTS = 10   # returned to Claude for filtering; individual queries fetch 5 each
_PER_QUERY = 5
_STOP_WORDS = {
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "is", "are", "was", "were", "has", "have", "had", "it",
    "its", "this", "that", "as", "by", "be", "do", "did", "will", "would",
    "could", "should", "from", "into", "about", "over", "after", "before",
}


def _get_key() -> Optional[str]:
    return os.environ.get("XAPI_KEY")


def _build_queries(story: dict[str, Any]) -> list[str]:
    """Return a list of individual targeted search terms, one per entity."""
    queries: list[str] = []

    ticker = story.get("ticker")
    company = story.get("companyName")
    people = story.get("people") or []
    topics = story.get("topics") or []

    if ticker:
        queries.append(f"${ticker}")

    if company and len(company) > 2:
        queries.append(f'"{company}"')

    person = people[0].strip() if people else None
    topic = next((t.strip() for t in topics if len(t.strip()) > 3), None)

    if person and topic:
        queries.append(f'"{person}" "{topic}"')
    elif person:
        queries.append(f'"{person}"')
    elif topic:
        queries.append(f'"{topic}"')

    # Fallback: keywords from title + insight
    if not queries:
        text = " ".join(filter(None, [story.get("title", ""), story.get("insight", "")]))
        words = [
            w for w in re.sub(r"[^a-zA-Z\s]", "", text).split()
            if w.lower() not in _STOP_WORDS and len(w) > 3
        ]
        seen: set[str] = set()
        unique = [w for w in words if not (w.lower() in seen or seen.add(w.lower()))]  # type: ignore[func-returns-value]
        queries = [f'"{w}"' for w in unique[:3]]

    return queries


async def _search_one(client: httpx.AsyncClient, api_key: str, query: str) -> list[dict[str, Any]]:
    """Run a single search query and return parsed tweet dicts."""
    search_query = f"({query}) -is:retweet lang:en"
    try:
        resp = await client.get(
            f"{XAPI_BASE}/twitter/tweet/advanced_search",
            params={"q": search_query, "product": "Latest"},
            headers={"Authorization": f"Bearer {api_key}"},
        )
    except httpx.TimeoutException:
        log.info("XAPI: timeout for query '%s'", query)
        return []
    except Exception as exc:  # noqa: BLE001
        log.info("XAPI: error for query '%s': %s", query, exc)
        return []

    if resp.status_code == 401:
        log.info("XAPI: 401 Unauthorized — check XAPI_KEY")
        return []
    if resp.status_code == 422:
        log.info("XAPI: 422 bad query '%s'", search_query[:80])
        return []
    if resp.status_code != 200:
        log.info("XAPI: %d for query '%s'", resp.status_code, query)
        return []

    raw_tweets = resp.json().get("tweets", [])
    if not raw_tweets:
        log.info("XAPI: 0 tweets for '%s'", query)
        return []

    results: list[dict[str, Any]] = []
    for tweet in raw_tweets[:_PER_QUERY]:
        author = tweet.get("author") or {}
        username = author.get("userName", "unknown")
        tweet_id = tweet.get("id", "")
        results.append({
            "id": tweet_id,
            "text": tweet.get("text", ""),
            "author": f"@{username}",
            "authorName": author.get("name", username),
            "authorAvatar": author.get("profilePicture", ""),
            "url": tweet.get("url") or f"https://x.com/{username}/status/{tweet_id}",
            "likes": tweet.get("likeCount", 0),
            "retweets": tweet.get("retweetCount", 0),
            "createdAt": tweet.get("createdAt", ""),
        })

    log.info("XAPI: %d tweet(s) for '%s'", len(results), query)
    return results


async def fetch_story_tweets(story: dict[str, Any], max_results: int = MAX_RESULTS) -> list[dict[str, Any]]:
    """Run per-entity searches concurrently and return merged, deduplicated results."""
    api_key = _get_key()
    if not api_key:
        log.info("XAPI_KEY not set — skipping tweet fetch")
        return []

    queries = _build_queries(story)
    if not queries:
        return []

    log.info("XAPI: %d queries for '%s': %s", len(queries), story.get("title", "")[:60], queries)

    async with httpx.AsyncClient(timeout=15.0) as client:
        batches = await asyncio.gather(*[_search_one(client, api_key, q) for q in queries])

    # Deduplicate by tweet ID, preserving first-seen order
    seen_ids: set[str] = set()
    merged: list[dict[str, Any]] = []
    for batch in batches:
        for tweet in batch:
            if tweet["id"] not in seen_ids:
                seen_ids.add(tweet["id"])
                merged.append(tweet)

    merged.sort(key=lambda t: t["likes"] + t["retweets"], reverse=True)
    return merged[:max_results]
