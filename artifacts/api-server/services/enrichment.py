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
    "down over text. Even heavy, serious stories should feel accessible and "
    "human — never dry, never preachy, never like a textbook.\n\n"
    "Write STORYSUMMARY (4-6 sentences, max 800 characters): tell the story "
    "like you're explaining it to a friend who just asked 'wait, what happened?' "
    "Lead with the most interesting or surprising part. Give enough context that "
    "someone with zero background on this story fully understands what's going on "
    "and why people are talking about it. Use plain conversational language — "
    "short sentences, active voice, zero jargon. It's okay to have a little "
    "personality here. Make them want to keep reading. No financial angle. "
    "Just the story, told well.\n\n"
    "Write LIFEIMPACT (3-4 sentences, max 500 characters): how does this "
    "directly affect the reader's actual life — their rent, job, groceries, "
    "career, relationships, mental load, or future. Be specific and concrete. "
    "Don't just say 'this could affect jobs' — say which jobs, in what way, "
    "and roughly when. Start with 'You' or 'If you' when possible. Give enough "
    "detail that the reader walks away knowing exactly what to pay attention to "
    "in their own life. This is the heart of CRRNT — make it hit.\n\n"
    "Write WALLETIMPACT (3-4 sentences, max 500 characters): two things in one "
    "section. First, explain the everyday money ripple effect — name the specific "
    "thing that costs more or less, the job category that takes a hit, the bill "
    "that changes. Be concrete: 'groceries' not 'consumer goods', 'your rent' "
    "not 'housing costs'. No econ-speak. No 'market volatility.' Just real talk "
    "about real costs. If the impact is genuinely uncertain, say that honestly — "
    "'nobody really knows yet, but here's what to watch.' "
    "Second, briefly explain what this might mean for the related stock if one "
    "exists — will this likely push the stock up or down and why, in one plain "
    "sentence. If no stock is clearly relevant, skip the stock note entirely. "
    "Never use trading language — just say 'this could push [company] stock up' "
    "or 'investors might get nervous about [company]' in plain terms.\n\n"
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
    "TONE OVERALL: Think Vox meets group chat. Informed but never stuffy. "
    "Honest about uncertainty. Never fear-mongering. Never dismissive. "
    "If a story is genuinely scary or heavy, it's okay to acknowledge that — "
    "but always land on clarity, not anxiety.\n\n"
    "ALWAYS reply with a single JSON object — no prose, no markdown fences — "
    "with keys: storySummary (string), lifeImpact (string), walletImpact (string), "
    "insight (string), ticker (string|null), companyName (string|null), "
    "category (string, optional)."
)

SENTIMENT_SYSTEM_PROMPT = (
    "You analyze social media sentiment about news stories for CRRNT — an app "
    "for young adults who want to understand what the world actually thinks "
    "about what's happening.\n\n"
    "Given a news story and posts from Twitter, write a casual honest summary "
    "of how real people feel — not Wall Street, not pundits. "
    "How are everyday people actually reacting? Angry? Worried? Hopeful? "
    "Cynical? Unbothered? Be direct. Avoid corporate tone entirely.\n\n"
    "ALWAYS reply with a single JSON object — no prose, no markdown fences — "
    "with keys: sentiment ('concerned'|'hopeful'|'angry'|'divided'|'unbothered'|'mixed'), "
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
        log.info("Claude pass 1: enriching '%s'", title[:70])
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
        log.info("Claude enrichment failed for %s: %s", title[:60], exc)
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
    log.info(
        "Claude pass 1 done: '%s' → ticker=%s category=%s",
        title[:60],
        ticker or "none",
        story.get("category", category),
    )
    return story


async def enrich_story_tweets(story: dict[str, Any], tweets: list[dict[str, Any]]) -> dict[str, Any]:
    """Pass 2: Analyze tweet sentiment with Claude. Mutates story in-place."""
    if not tweets:
        return story

    title = story.get("title", "")
    ticker = story.get("ticker", "")
    summary = story.get("storySummary") or story.get("description") or ""
    tweets_text = "\n".join(
        f"- @{t.get('authorName', '?')}: {t.get('text', '')} [♥{t.get('likes', 0)} 🔁{t.get('retweets', 0)}]"
        for t in tweets[:8]
    )

    user_prompt = (
        f"Article: {title}\n"
        f"Ticker: {ticker or 'N/A'}\n"
        f"Summary: {summary[:300]}\n\n"
        f"Tweets:\n{tweets_text}\n\n"
        "Reply with JSON only."
    )

    try:
        client = _get_client()
        log.info("Claude pass 2: sentiment for '%s' (%d tweet(s))", title[:60], len(tweets))
        msg = await client.messages.create(
            model=MODEL,
            max_tokens=300,
            system=SENTIMENT_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = "".join(
            block.text for block in msg.content if getattr(block, "type", "") == "text"
        )
        parsed = _parse_json(text)
    except Exception as exc:  # noqa: BLE001
        log.info("Tweet sentiment failed for %s: %s", title[:60], exc)
        parsed = {}

    # Tweets always attach — they came from a targeted person+topic search so
    # they're relevant by construction. Claude only adds the summary/sentiment.
    story["tweets"] = tweets
    story["sentiment"] = parsed.get("sentiment") or "mixed"
    story["peopleSay"] = (parsed.get("peopleSay") or "").strip() or None
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
