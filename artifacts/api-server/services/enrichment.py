"""Claude-powered enrichment for news stories.

Pass 1 — Claude extracts per story:
  ticker, companyName, insight, walletImpact, lifeImpact, category

Pass 2 — For stories with tweets from GetXAPI:
  peopleSay, sentiment  (via a second, lightweight Claude call)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Any, Optional

from anthropic import AsyncAnthropic

log = logging.getLogger("marktr.enrichment")

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
    "Write STORYSUMMARY (3-5 sentences, max 600 characters): a plain language "
    "summary of what actually happened. No financial angle. No jargon. Just "
    "the story, clearly told.\n\n"
    "Write LIFEIIMPACT (2-3 sentences, max 350 characters): the most important "
    "thing — how does this directly affect the reader's life. Their rent, job, "
    "groceries, career, relationships, mental load, or future. Be specific and "
    "concrete. Start with 'You' or 'If you' when possible. This is the heart "
    "of CRRNT — make it hit.\n\n"
    "Write WALLETIMPACT (2-3 sentences, max 320 characters): the financial "
    "ripple effect on everyday people — prices, costs, wages, job market, "
    "spending power. Not stocks or investing. Think: will this make something "
    "cost more? Will it affect hiring? Speak like a friend, not an economist.\n\n"
    "Write INSIGHT (1 sentence, under 110 characters): a punchy, memorable "
    "one-liner that captures why this story matters to a young adult right now. "
    "Hook them in. Make it feel urgent and real.\n\n"
    "TICKER: Optionally identify the most relevant publicly traded US stock "
    "ticker if one is clearly central to the story (e.g. AAPL, TSLA, META). "
    "This is secondary context — not the focus. Return null if not clearly relevant.\n\n"
    "CATEGORY REFINEMENT: When the input category is 'celebrity', classify "
    "further. Set 'category' to 'celebrity' if the story is about a famous "
    "person's life, relationships, or personal drama. Set 'category' to "
    "'entertainment' if the story is about a movie, show, music release, "
    "streaming platform, or media franchise. Omit 'category' for all others.\n\n"
    "ALWAYS reply with a single JSON object — no prose, no markdown fences — "
    "with keys: storySummary (string), lifeImpact (string), walletImpact (string), "
    "insight (string), ticker (string|null), companyName (string|null), "
    "category (string, optional)."
)

SENTIMENT_SYSTEM_PROMPT = (
    "You analyze social media sentiment about news stories for CRRNT — an app "
    "for young adults who want to understand what the world actually thinks "
    "about what's happening.\n\n"
    "Given a set of real posts from Twitter and Reddit, first decide if the "
    "tweets are actually relevant to the story. Set relevant to false if the "
    "tweets are spam, bot activity, unrelated to the story, or mostly scam "
    "promotions. If relevant is false, skip the other fields.\n\n"
    "If relevant is true: write a casual, honest sentiment summary that captures "
    "the vibe of real people — not Wall Street, not pundits. How are everyday "
    "people actually feeling? Angry? Worried? Hopeful? Cynical? Unbothered? "
    "Be direct. Avoid corporate tone entirely.\n\n"
    "ALWAYS reply with a single JSON object — no prose, no markdown fences — "
    "with keys: relevant (boolean), sentiment ('concerned'|'hopeful'|'angry'|'divided'|'unbothered'|'mixed'), "
    "peopleSay (string, 2-3 sentences, max 280 characters, casual conversational tone)."
)


async def enrich_story(story: dict[str, Any]) -> dict[str, Any]:
    """Pass 1: Enrich a single story with Claude. Returns story dict updated in-place."""
    title = story.get("title") or ""
    description = story.get("description") or ""
    category = story.get("category") or ""
    source = story.get("source") or ""

    user_prompt = (
        f"Category: {category}\n"
        f"Source: {source}\n"
        f"Headline: {title}\n"
        f"Summary: {description}\n\n"
        "Reply with the JSON object only."
    )

    try:
        client = _get_client()
        msg = await client.messages.create(
            model=MODEL,
            max_tokens=600,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = "".join(
            block.text for block in msg.content if getattr(block, "type", "") == "text"
        )
        parsed = _parse_json(text)
    except Exception as exc:  # noqa: BLE001
        log.warning("Claude enrichment failed for %s: %s", title[:60], exc)
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
        insight = _fallback_insight(category, title)

    wallet_impact = (parsed.get("walletImpact") or "").strip()
    if not wallet_impact:
        wallet_impact = (
            "This story may ripple through everyday finances — "
            "from prices at the checkout to hiring in the industry. "
            "Keep an eye on how it develops."
        )

    life_impact = (parsed.get("lifeImpact") or "").strip()
    if not life_impact:
        life_impact = (
            "This story may have real effects on everyday life — "
            "from your job to your wallet to your community. "
            "Keep an eye on how it develops."
        )

    story_summary = (parsed.get("storySummary") or "").strip()
    if not story_summary:
        story_summary = (description or title or "").strip() or None

    # Refine category for celebrity→entertainment split
    refined_cat = (parsed.get("category") or "").strip().lower()
    if refined_cat in ("celebrity", "entertainment") and story.get("category") == "celebrity":
        story["category"] = refined_cat

    story["ticker"] = ticker
    story["companyName"] = company_name
    story["insight"] = insight
    story["walletImpact"] = wallet_impact
    story["lifeImpact"] = life_impact
    story["storySummary"] = story_summary
    # Tweet fields — populated in Pass 2 if tweets are found
    story.setdefault("peopleSay", None)
    story.setdefault("sentiment", None)
    story.setdefault("tweets", [])
    return story


async def enrich_story_tweets(story: dict[str, Any], tweets: list[dict[str, Any]]) -> dict[str, Any]:
    """Pass 2: Analyze tweet sentiment with Claude. Mutates story in-place."""
    if not tweets:
        return story

    title = story.get("title", "")
    ticker = story.get("ticker", "")
    tweets_text = "\n".join(
        f"- @{t.get('authorName', '?')}: {t.get('text', '')} [♥{t.get('likes', 0)} 🔁{t.get('retweets', 0)}]"
        for t in tweets[:5]
    )

    user_prompt = (
        f"Article: {title}\n"
        f"Ticker: {ticker or 'N/A'}\n\n"
        f"Tweets:\n{tweets_text}\n\n"
        "Reply with JSON only."
    )

    try:
        client = _get_client()
        msg = await client.messages.create(
            model=MODEL,
            max_tokens=200,
            system=SENTIMENT_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = "".join(
            block.text for block in msg.content if getattr(block, "type", "") == "text"
        )
        parsed = _parse_json(text)
    except Exception as exc:  # noqa: BLE001
        log.warning("Tweet sentiment failed for %s: %s", title[:60], exc)
        parsed = {}

    relevant = parsed.get("relevant", True)
    if not relevant:
        story["sentiment"] = None
        story["peopleSay"] = "Not much buzz around this topic."
        story["tweets"] = []
        return story

    story["sentiment"] = parsed.get("sentiment") or "mixed"
    story["peopleSay"] = (parsed.get("peopleSay") or "").strip() or None
    story["tweets"] = tweets
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


def _fallback_insight(category: str, title: str) -> str:
    topic = (title or "this story").strip()
    if len(topic) > 80:
        topic = topic[:77] + "..."
    return f"A fresh {category} headline worth watching: {topic}"


async def enrich_all(stories: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Run both enrichment passes for all stories."""
    from services import xapi  # avoid circular at module level

    # Pass 1: Claude enrichment (ticker, insight, walletImpact, lifeImpact)
    sem1 = asyncio.Semaphore(MAX_CONCURRENCY)

    async def _bounded_enrich(story: dict[str, Any]) -> dict[str, Any]:
        async with sem1:
            return await enrich_story(story)

    enriched = await asyncio.gather(*[_bounded_enrich(s) for s in stories])

    # Pass 2: Tweet fetch + sentiment (only for stories with tickers)
    sem2 = asyncio.Semaphore(MAX_CONCURRENCY_TWEETS)

    async def _bounded_tweets(story: dict[str, Any]) -> dict[str, Any]:
        async with sem2:
            tweets = await xapi.fetch_story_tweets(story)
            if tweets:
                return await enrich_story_tweets(story, tweets)
            return story

    enriched = await asyncio.gather(*[_bounded_tweets(s) for s in enriched])

    # Pass 3: Fish Audio TTS synthesis (no-ops when FISH_AUDIO_API_KEY is unset)
    from services import fish_audio  # avoid circular at module level
    enriched = await fish_audio.synthesize_all(list(enriched))

    return list(enriched)
