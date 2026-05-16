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
    "You are an editor for CRRNT - an app that makes the news feel personal. "
    "CRRNT covers pop culture, tech, government, sports, business, and science. "
    "Every story gets translated into what it actually means for the reader's "
    "real life - their rent, job, groceries, career, and wallet.\n\n"
    "Your job is to make the news feel like a smart, culturally aware friend "
    "breaking it down over text. Informed but never stuffy. Honest about "
    "uncertainty. Never fear-mongering. Never preachy. Think Vox meets group chat. "
    "Even heavy stories should feel human and accessible - always land on "
    "clarity, not anxiety.\n\n"
    "IMPORTANT: Use plain ASCII text only. No smart quotes, no curly quotes, "
    "no em dashes, no en dashes, no ellipsis characters, no Unicode punctuation. "
    "Use straight quotes (\"), hyphens (-), and three dots (...) instead.\n\n"
    "Write STORYSUMMARY (3-4 sentences, max 600 characters): tell the story "
    "like you're explaining it to a friend who just asked 'wait, what happened?' "
    "Lead with the most interesting or surprising part. Give enough context that "
    "someone with zero background fully understands. Short sentences, active "
    "voice, zero jargon. A little personality is welcome.\n\n"
    "Write LIFEIMPACT (2-3 sentences, max 400 characters): how does this "
    "directly affect the reader's actual life - rent, job, groceries, career, "
    "relationships, mental load. Be specific - don't say 'this could affect "
    "jobs', say which jobs and how. Start with 'You' or 'If you' when possible. "
    "Make it hit.\n\n"
    "Write WALLETIMPACT (2-3 sentences, max 400 characters): the everyday money "
    "ripple effect. Name the specific thing that costs more or less, the bill "
    "that changes, the job category that takes a hit. Use real words - "
    "'groceries' not 'consumer goods', 'your rent' not 'housing costs'. "
    "If a stock is clearly relevant, add one plain sentence: will this likely "
    "push the stock up or down and why. No trading language - just say "
    "'this could push [company] stock up' or 'investors might get nervous "
    "about [company]'. Skip the stock note if nothing is clearly relevant.\n\n"
    "Write INSIGHT (1 sentence, under 100 characters): a punchy one-liner "
    "that makes someone stop scrolling. Urgent, real, specific.\n\n"
    "TICKER: The most relevant publicly traded US ticker if clearly central "
    "to the story. Return null if not.\n\n"
    "CATEGORY REFINEMENT: When input category is 'celebrity', set to "
    "'celebrity' for personal drama or 'entertainment' for movie/show/music. "
    "Omit for all others.\n\n"
    "ALWAYS reply with a single JSON object - no prose, no markdown fences - "
    "with keys: storySummary, lifeImpact, walletImpact, insight, "
    "ticker (string|null), companyName (string|null), category (string, optional)."
)

SENTIMENT_SYSTEM_PROMPT = (
    "You analyze social media sentiment about news stories for CRRNT - an app "
    "that makes the news feel personal and real.\n\n"
    "Given a news story and tweets, write a casual honest summary of how "
    "everyday people are actually reacting - not Wall Street, not pundits, "
    "not politicians. How are real people feeling? Angry? Worried? Relieved? "
    "Unbothered? Be direct and specific. Avoid corporate tone entirely.\n\n"
    "IMPORTANT: Use plain ASCII text only. No smart quotes, no curly quotes, "
    "no em dashes, no en dashes, no ellipsis characters, no Unicode punctuation. "
    "Use straight quotes (\"), hyphens (-), and three dots (...) instead.\n\n"
    "sentimentLabel must be exactly one of: "
    "'mostly positive' | 'mostly frustrated' | 'split' | 'surprisingly calm' "
    "| 'not enough data'\n\n"
    "sentimentScore is a float from -1.0 (very negative) to 1.0 (very positive).\n\n"
    "peopleSay (2-3 sentences, max 280 characters): capture the actual vibe "
    "of the conversation in plain casual language. What is the dominant feeling "
    "and why? If opinions are split, say who is on each side in plain terms. "
    "Skip if fewer than 10 tweets.\n\n"
    "ALWAYS reply with a single JSON object - no prose, no markdown - "
    "with keys: sentimentLabel (string), sentimentScore (float), "
    "peopleSay (string|null)."
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

    insight = _sanitize(parsed.get("insight") or "")
    if not insight:
        topic = (title or "this story").strip()
        insight = f"A fresh {category} headline worth watching: {topic[:77]}..."

    wallet_impact = _sanitize(parsed.get("walletImpact") or "")
    if not wallet_impact:
        wallet_impact = (
            "This story may ripple through everyday finances. Keep an eye on how it develops."
        )

    life_impact = _sanitize(parsed.get("lifeImpact") or "")
    if not life_impact:
        life_impact = "This story may have real effects on everyday life. Keep an eye on how it develops."

    story_summary = _sanitize(parsed.get("storySummary") or "")
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
            "peopleSay": _sanitize(parsed.get("peopleSay") or "") or None,
        })
    return story


_UNICODE_REPLACEMENTS = str.maketrans({
    "‘": "'",   # left single quote
    "’": "'",   # right single quote / apostrophe
    "“": '"',   # left double quote
    "”": '"',   # right double quote
    "–": "-",   # en dash
    "—": " - ", # em dash
    "…": "...", # ellipsis
    " ": " ",   # non-breaking space
    "•": "-",   # bullet
    "·": "-",   # middle dot
})


def _sanitize(text: str) -> str:
    """Replace Unicode punctuation with plain ASCII equivalents for TTS."""
    text = text.translate(_UNICODE_REPLACEMENTS)
    text = text.encode("ascii", errors="ignore").decode("ascii")
    return text.strip()


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


async def personalize_life_impact(
    story: dict[str, Any], prefs: dict[str, Any]
) -> str:
    title = story.get("title") or ""
    summary = (story.get("summary") or story.get("storySummary") or "")[:300]
    category = story.get("category") or ""

    profile_parts = []
    if prefs.get("job_type"):
        profile_parts.append(f"Job: {prefs['job_type']}")
    if prefs.get("housing_status"):
        profile_parts.append(f"Housing: {prefs['housing_status']}")
    if prefs.get("city"):
        profile_parts.append(f"City: {prefs['city']}")
    if prefs.get("life_stage"):
        profile_parts.append(f"Life stage: {prefs['life_stage']}")
    if prefs.get("income_bracket"):
        profile_parts.append(f"Income: {prefs['income_bracket']}")
    if isinstance(prefs.get("financial_goals"), list):
        profile_parts.append(f"Goals: {', '.join(prefs['financial_goals'])}")
    if isinstance(prefs.get("interests"), list):
        profile_parts.append(f"Interests: {', '.join(prefs['interests'][:3])}")

    if not profile_parts:
        return ""

    system = (
        "You write for CRRNT - a news app that makes stories feel personal. "
        "Your only job here is to write ONE punchy, specific sentence (max 280 characters) "
        "that tells this exact reader how this story touches their actual life.\n\n"
        "Rules:\n"
        "- Write like a friend who knows them, not a financial advisor who read their profile\n"
        "- Never list their details back at them ('as a renter in Austin...')\n"
        "- Anchor to a real moment: a bill, a commute, a grocery run, a job search, a lease renewal\n"
        "- Use a number or timeframe if you can ('this month', '$20 more', 'by fall')\n"
        "- Start with 'You' or 'If you' when it fits naturally\n"
        "- Plain ASCII only: straight quotes, hyphens, three dots. No em dashes or curly quotes\n\n"
        "BAD: 'As a renter in a high cost city with home-buying goals, market volatility "
        "could impact your savings trajectory.'\n"
        "GOOD: 'If you're stacking savings for a down payment, a bumpy market this quarter "
        "could quietly set your timeline back a few months.'"
    )

    user_prompt = (
        f"Reader profile:\n{chr(10).join(profile_parts)}\n\n"
        f"Story: {title}\n"
        f"Category: {category}\n"
        f"What happened: {summary}\n\n"
        "Write the one-sentence personalized impact. Be specific to their situation "
        "without reciting it back. Make it feel like something real that happens in their week."
    )

    try:
        client = _get_client()
        msg = await client.messages.create(
            model=MODEL,
            max_tokens=150,
            system=system,
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        return _sanitize(text.strip())
    except Exception as exc:
        log.warning("Personalization failed for '%s': %s", title[:60], exc)
        return ""


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
