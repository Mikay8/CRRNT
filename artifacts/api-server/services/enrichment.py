"""Claude-powered enrichment for news stories.

Pass 1 — Claude extracts per story:
  storySummary, lifeImpact, walletImpact, insight, stock_note,
  ticker, companyName, category

Pass 2 — Tweet sentiment (X API data):
  sentimentLabel, sentimentScore, peopleSay
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Any, Optional

from anthropic import AsyncAnthropic

log = logging.getLogger("crrnt.enrichment")

MODEL = "claude-haiku-4-5"
MAX_CONCURRENCY = 5
MAX_CONCURRENCY_TWEETS = 3

_client: Optional[AsyncAnthropic] = None


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set")
        _client = AsyncAnthropic(api_key=api_key)
    return _client


SYSTEM_PROMPT = (
    "You are an editor for CRRNT — an app that helps young adults understand "
    "what's really going on in the world and what it means for their actual life. "
    "CRRNT covers pop culture, tech, government, sports, business, and science.\n\n"
    "Your job is not to explain markets. Your job is to make the news feel "
    "personally relevant — like a smart, culturally aware friend breaking it "
    "down over text.\n\n"
    "Write STORYSUMMARY (4-6 sentences, max 800 characters): tell the story "
    "like you're explaining it to a friend. Lead with the most interesting part. "
    "Plain conversational language, short sentences, active voice, zero jargon.\n\n"
    "Write LIFEIMPACT (3-4 sentences, max 500 characters): how does this "
    "directly affect the reader's actual life — rent, job, groceries, career, "
    "relationships. Be specific. Start with 'You' or 'If you' when possible.\n\n"
    "Write WALLETIMPACT (3-4 sentences, max 500 characters): the everyday money "
    "ripple effect — name the specific cost, job category, or bill that changes. "
    "If a stock is clearly relevant, add one plain sentence about direction. "
    "No econ-speak.\n\n"
    "Write INSIGHT (1 sentence, under 110 characters): a punchy one-liner "
    "capturing why this story matters to a young adult right now.\n\n"
    "TICKER: Optionally the most relevant publicly traded US ticker (e.g. AAPL). "
    "Return null if not clearly relevant.\n\n"
    "CATEGORY REFINEMENT: When input category is 'celebrity', set to 'celebrity' "
    "for personal drama, or 'entertainment' for movie/show/music content. "
    "Omit for all others.\n\n"
    "ALWAYS reply with a single JSON object — no prose, no markdown fences — "
    "with keys: storySummary, lifeImpact, walletImpact, insight, "
    "ticker (string|null), companyName (string|null), category (string, optional)."
)

SENTIMENT_SYSTEM_PROMPT = (
    "You analyze social media sentiment about news stories for CRRNT.\n\n"
    "Given a news story and tweets, write a casual honest summary of how real "
    "people feel — not Wall Street, not pundits. Be direct. Avoid corporate tone.\n\n"
    "sentimentLabel must be exactly one of: "
    "'mostly positive' | 'mostly frustrated' | 'split' | 'surprisingly calm' | 'not enough data'\n\n"
    "sentimentScore is a float from -1.0 (very negative) to 1.0 (very positive).\n\n"
    "peopleSay: 2-3 sentences, max 280 characters, casual conversational tone. "
    "Skip if fewer than 10 tweets.\n\n"
    "ALWAYS reply with a single JSON object — no prose, no markdown — "
    "with keys: sentimentLabel (string), sentimentScore (float), peopleSay (string|null)."
)


async def enrich_story(story: dict[str, Any]) -> dict[str, Any]:
    """Pass 1: Claude enrichment."""
    title = story.get("title") or ""
    description = story.get("description") or ""
    category = story.get("category") or ""
    source = story.get("source") or ""

    user_prompt = (
        f"Category: {category}\nSource: {source}\n"
        f"Headline: {title}\nSummary: {description}\n\nReply with the JSON object only."
    )

    try:
        client = _get_client()
        log.info("Claude pass 1: '%s'", title[:70])
        msg = await client.messages.create(
            model=MODEL,
            max_tokens=700,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = "".join(
            b.text for b in msg.content if getattr(b, "type", "") == "text"
        )
        parsed = _parse_json(text)
    except Exception as exc:
        log.warning("Claude pass 1 failed for '%s': %s", title[:60], exc)
        parsed = {}

    ticker = parsed.get("ticker")
    if isinstance(ticker, str):
        ticker = ticker.strip().upper() or None
        if ticker and not re.fullmatch(r"[A-Z.\-]{1,6}", ticker):
            ticker = None
    else:
        ticker = None

    company_name = parsed.get("companyName")
    if isinstance(company_name, str):
        company_name = company_name.strip() or None
    else:
        company_name = None

    insight = (parsed.get("insight") or "").strip()
    if not insight:
        topic = (title or "this story").strip()
        insight = f"A fresh {category} headline worth watching: {topic[:77]}..."

    wallet_impact = (parsed.get("walletImpact") or "").strip()
    if not wallet_impact:
        wallet_impact = (
            "This story may ripple through everyday finances. Keep an eye on how it develops."
        )

    life_impact = (parsed.get("lifeImpact") or "").strip()
    if not life_impact:
        life_impact = "This story may have real effects on everyday life. Keep an eye on how it develops."

    story_summary = (parsed.get("storySummary") or "").strip()
    if not story_summary:
        story_summary = (description or title or "").strip() or None

    refined_cat = (parsed.get("category") or "").strip().lower()
    if refined_cat in ("celebrity", "entertainment") and story.get("category") == "celebrity":
        story["category"] = refined_cat

    story.update({
        "ticker": ticker,
        "companyName": company_name,
        "insight": insight,
        "walletImpact": wallet_impact,
        "lifeImpact": life_impact,
        "storySummary": story_summary,
        "peopleSay": None,
        "sentimentLabel": None,
        "sentimentScore": None,
        "tweets": [],
    })
    log.info("Pass 1 done: '%s' ticker=%s", title[:60], ticker or "none")
    return story


async def enrich_story_tweets(
    story: dict[str, Any], tweets: list[dict[str, Any]]
) -> dict[str, Any]:
    """Pass 2: tweet sentiment analysis."""
    if not tweets:
        return story

    title = story.get("title", "")
    ticker = story.get("ticker", "")
    summary = story.get("storySummary") or story.get("description") or ""
    tweets_text = "\n".join(
        f"- @{t.get('authorName','?')}: {t.get('text','')} "
        f"[♥{t.get('likes',0)} 🔁{t.get('retweets',0)}]"
        for t in tweets[:8]
    )
    tweet_count = len(tweets)

    user_prompt = (
        f"Article: {title}\nTicker: {ticker or 'N/A'}\n"
        f"Summary: {summary[:300]}\nTweet count: {tweet_count}\n\n"
        f"Tweets:\n{tweets_text}\n\nReply with JSON only."
    )

    try:
        client = _get_client()
        msg = await client.messages.create(
            model=MODEL,
            max_tokens=300,
            system=SENTIMENT_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = "".join(
            b.text for b in msg.content if getattr(b, "type", "") == "text"
        )
        parsed = _parse_json(text)
    except Exception as exc:
        log.warning("Tweet sentiment failed for '%s': %s", title[:60], exc)
        parsed = {}

    # If fewer than 10 tweets, force "not enough data"
    if tweet_count < 10:
        story.update({
            "tweets": tweets,
            "sentimentLabel": "not enough data",
            "sentimentScore": None,
            "peopleSay": None,
        })
    else:
        score = parsed.get("sentimentScore")
        if score is not None:
            try:
                score = max(-1.0, min(1.0, float(score)))
            except (TypeError, ValueError):
                score = None

        story.update({
            "tweets": tweets,
            "sentimentLabel": parsed.get("sentimentLabel") or "split",
            "sentimentScore": score,
            "peopleSay": (parsed.get("peopleSay") or "").strip() or None,
        })
    return story


def _parse_json(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group(0))
                if isinstance(data, dict):
                    return data
            except json.JSONDecodeError:
                pass
    return {}


def _is_buzzfeed_quiz(story: dict[str, Any]) -> bool:
    source = (story.get("source") or "").strip().lower()
    title = (story.get("title") or "").strip().lower()
    return "buzzfeed" in source and "quiz" in title


async def enrich_all(stories: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Run both enrichment passes for all stories."""
    from services import xapi

    sem1 = asyncio.Semaphore(MAX_CONCURRENCY)

    async def _bounded_enrich(s: dict[str, Any]) -> dict[str, Any]:
        async with sem1:
            return await enrich_story(s)

    enriched = list(await asyncio.gather(*[_bounded_enrich(s) for s in stories]))

    sem2 = asyncio.Semaphore(MAX_CONCURRENCY_TWEETS)

    async def _bounded_tweets(s: dict[str, Any]) -> dict[str, Any]:
        if _is_buzzfeed_quiz(s):
            return s
        if not (s.get("ticker") or s.get("people") or s.get("topics")):
            return s
        async with sem2:
            tweets = await xapi.fetch_story_tweets(s)
            if tweets:
                return await enrich_story_tweets(s, tweets)
            return s

    enriched = list(await asyncio.gather(*[_bounded_tweets(s) for s in enriched]))
    return enriched
