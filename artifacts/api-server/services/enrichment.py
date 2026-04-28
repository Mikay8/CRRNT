"""Claude-powered enrichment for news stories.

For each story we extract a primary stock ticker (or null), a short
one-line insight, and a plain-language explanation aimed at young adults
who are new to investing.
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
    "You are a financial editor for Marktr — an app that helps young adults "
    "see the money story inside pop culture, tech, government, and sports news. "
    "For each story, identify the most relevant publicly traded stock ticker "
    "(US exchanges only, e.g. AAPL, NKE, DIS, TSLA, META). If there is no "
    "clearly related stock, return null for ticker.\n\n"
    "Write a single-sentence INSIGHT (under 110 characters) — punchy, modern, "
    "and connecting the news to the money angle. Then write an EXPLANATION "
    "(2-3 sentences, max 320 characters) in plain language explaining how this "
    "news might affect that company or the broader market. Avoid jargon. Speak "
    "like a smart friend, not a finance textbook.\n\n"
    "CATEGORY REFINEMENT: When the input category is 'celebrity', you must also "
    "classify the story. Set 'category' to 'celebrity' if the story is primarily "
    "about a specific famous person's life, relationships, fashion, or personal "
    "drama. Set 'category' to 'entertainment' if the story is primarily about a "
    "movie, TV show, music release, concert, streaming platform, or media "
    "franchise. For all other input categories, omit the 'category' field.\n\n"
    "ALWAYS reply with a single JSON object — no prose, no markdown fences — "
    "with keys: ticker (string|null), companyName (string|null), "
    "insight (string), explanation (string), category (string, optional)."
)


async def enrich_story(story: dict[str, Any]) -> dict[str, Any]:
    """Enrich a single story with Claude. Returns the story dict in-place."""
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
            max_tokens=400,
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

    explanation = (parsed.get("explanation") or "").strip()
    if not explanation:
        explanation = (
            "We couldn't generate a fresh financial take on this story right now, "
            "but it's still worth keeping an eye on — markets often react to "
            "headlines like this in the days that follow."
        )

    # Refine category for celebrity→entertainment split
    refined_cat = (parsed.get("category") or "").strip().lower()
    if refined_cat in ("celebrity", "entertainment") and story.get("category") == "celebrity":
        story["category"] = refined_cat

    story["ticker"] = ticker
    story["companyName"] = company_name
    story["insight"] = insight
    story["explanation"] = explanation
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
    """Enrich a batch of stories in parallel with bounded concurrency."""
    sem = asyncio.Semaphore(MAX_CONCURRENCY)

    async def _bounded(story: dict[str, Any]) -> dict[str, Any]:
        async with sem:
            return await enrich_story(story)

    return await asyncio.gather(*[_bounded(s) for s in stories])
