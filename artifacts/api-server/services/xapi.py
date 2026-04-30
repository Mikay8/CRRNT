"""GetXAPI client — fetches recent tweets related to a news story.

Uses the getxapi.com service (Twitter/X API proxy). Searches for tweets
matching the story's company name or ticker and returns structured data
sorted by engagement.

Correct endpoint: GET /twitter/tweet/advanced_search?q=...&product=Latest
Response: { tweets: [...], tweet_count, has_more, next_cursor }
Each tweet has inline `author` object with userName, name, profilePicture, etc.
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any, Optional

import httpx

log = logging.getLogger("marktr.xapi")

XAPI_BASE = "https://api.getxapi.com"
MAX_RESULTS = 5
_STOP_WORDS = {
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "is", "are", "was", "were", "has", "have", "had", "it",
    "its", "this", "that", "as", "by", "be", "do", "did", "will", "would",
    "could", "should", "from", "into", "about", "over", "after", "before",
}


def _get_key() -> Optional[str]:
    return os.environ.get("XAPI_KEY")


def _build_query(story: dict[str, Any]) -> str:
    """Build a tweet search query from story metadata."""
    parts: list[str] = []
    ticker = story.get("ticker")
    if ticker:
        parts.append(f"${ticker}")

    company = story.get("companyName")
    if company and len(company) > 2:
        parts.append(f'"{company}"')

    topics = story.get("topics") or []
    people = story.get("people") or []
    if topics and people:
        first_topic = topics[0].strip()
        first_person = people[0].strip()
        if first_topic and first_person:
            parts.append(f'"{first_topic}" "{first_person}"')

    if not parts:
        # Extract keywords from title + insight for richer, topic-aware queries
        text = " ".join(filter(None, [story.get("title", ""), story.get("insight", "")]))
        words = [
            w for w in re.sub(r"[^a-zA-Z\s]", "", text).split()
            if w.lower() not in _STOP_WORDS and len(w) > 3
        ]
        seen: set[str] = set()
        unique = [w for w in words if not (w.lower() in seen or seen.add(w.lower()))]  # type: ignore[func-returns-value]
        parts = [f'"{w}"' for w in unique[:4]]

    query = " OR ".join(parts[:3]) if len(parts) > 1 else (parts[0] if parts else story.get("title", "")[:60])
    return query


async def fetch_story_tweets(story: dict[str, Any], max_results: int = MAX_RESULTS) -> list[dict[str, Any]]:
    """Search for recent tweets related to the story. Returns [] on any failure."""
    api_key = _get_key()
    if not api_key:
        log.info("XAPI_KEY not set — skipping tweet fetch")
        return []

    query = _build_query(story)
    if not query:
        return []

    # GetXAPI uses standard Twitter search query syntax
    search_query = f"({query}) -is:retweet lang:en"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{XAPI_BASE}/twitter/tweet/advanced_search",
                params={
                    "q": search_query,
                    "product": "Latest",
                },
                headers={"Authorization": f"Bearer {api_key}"},
            )

        if resp.status_code == 401:
            #log.info("XAPI: 401 Unauthorized — check XAPI_KEY")
            log.info("XAPI: 401 Unauthorized — check XAPI_KEY")
            return []
        if resp.status_code == 422:
            #log.info("XAPI: 422 Unprocessable — bad query '%s'", search_query[:80])
            log.info("XAPI: 422 Unprocessable — bad query '%s'", search_query[:80])
            return []
        if resp.status_code != 200:
            #log.info("XAPI: unexpected %d for query '%s': %s", resp.status_code, search_query[:60], resp.text[:200])
            log.info("XAPI: unexpected %d for query '%s'", resp.status_code, search_query[:60])
            return []

        data = resp.json()
        raw_tweets = data.get("tweets", [])
        if not raw_tweets:
            #log.debug("XAPI: 0 tweets for query '%s'", search_query[:60])
            log.info("XAPI: 0 tweets for query '%s'", search_query[:60])
            return []

        results: list[dict[str, Any]] = []
        for tweet in raw_tweets:
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

        results.sort(key=lambda t: t["likes"] + t["retweets"], reverse=True)
        trimmed = results[:max_results]
        #log.info("XAPI: %d tweet(s) for query '%s'", len(trimmed), search_query[:60])
        return trimmed

    except httpx.TimeoutException:
        #log.info("XAPI: timeout for query '%s'", search_query[:60])
        log.info("XAPI: timeout for query '%s'", search_query[:60])
        return []
    except Exception as exc:  # noqa: BLE001
        #log.info("XAPI: unexpected error for query '%s': %s", search_query[:60], exc)
        log.info("XAPI: unexpected error for query '%s': %s", search_query[:60], exc)
        return []
