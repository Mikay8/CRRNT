"""Claude- and Grok-powered enrichment for news stories.

Pass 1 — Claude extracts per story:
  storySummary, lifeImpact, walletImpact (nullable - omitted when the story
  has no meaningful money angle), insight, stock_note, ticker, companyName,
  category

Pass 2 — Grok searches X directly (x_search tool) and analyzes sentiment:
  sentimentLabel, sentimentScore, peopleSay

Pass 2b — StockTwits ticker sentiment (cheap replacement for Pass 2, used
  only when a story HAS a ticker): pull the ticker's recent StockTwits
  stream (public endpoint, no auth), keep only the posts that actually
  relate to THIS story, and let Haiku analyze those into the same
  sentimentLabel / sentimentScore / peopleSay / featuredPosts fields.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx
from anthropic import AsyncAnthropic
from xai_sdk import AsyncClient as AsyncXaiClient
from xai_sdk.chat import system as xai_system, user as xai_user
from xai_sdk.tools import x_search

log = logging.getLogger("crrnt.enrichment")

MODEL = "claude-haiku-4-5"
GROK_MODEL = "grok-4.6"
MAX_CONCURRENCY = 5
MAX_CONCURRENCY_TWEETS = 3

_client: Optional[AsyncAnthropic] = None
_xai_client: Optional[AsyncXaiClient] = None


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set")
        _client = AsyncAnthropic(api_key=api_key)
    return _client


def _get_xai_client() -> AsyncXaiClient:
    global _xai_client
    if _xai_client is None:
        api_key = os.environ.get("XAI_API_KEY")
        if not api_key:
            raise RuntimeError("XAI_API_KEY is not set")
        _xai_client = AsyncXaiClient(api_key=api_key)
    return _xai_client


SYSTEM_PROMPT = (
    "You are an editor for CRRNT - an app that makes the news feel personal. "
    "CRRNT covers pop culture, tech, government, sports, business, science, "
    "world news, and health. "
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
    "Write WALLETIMPACT (2-3 sentences, max 400 characters) ONLY if this story "
    "has a real, specific everyday money impact - a bill that changes, a price "
    "that moves, a job category that takes a hit, a stock that reacts. Name the "
    "specific thing. Use real words - 'groceries' not 'consumer goods', 'your "
    "rent' not 'housing costs'. If a stock is clearly relevant, add one plain "
    "sentence: will this likely push the stock up or down and why. No trading "
    "language - just say 'this could push [company] stock up' or 'investors "
    "might get nervous about [company]'. Skip the stock note if nothing is "
    "clearly relevant.\n\n"
    "If the story has no meaningful wallet or financial angle (e.g. pure "
    "celebrity drama, a sports result, a cultural moment with no money "
    "ripple), set walletImpact to null. Do not invent a stretch or generic "
    "money angle just to fill the field - null is the correct, expected "
    "answer for a lot of stories.\n\n"
    "If the story involves a death (an obituary, a fatal accident, a killing, "
    "a death toll), always set walletImpact to null, even if a stock or "
    "financial angle technically exists. Tying someone's death to a money "
    "angle reads as callous - skip it entirely for these stories.\n\n"
    "Write INSIGHT (1 sentence, under 100 characters): a punchy one-liner "
    "that makes someone stop scrolling. Urgent, real, specific.\n\n"
    "TICKER: The most relevant publicly traded US ticker if clearly central "
    "to the story. Return null if not.\n\n"
    "CATEGORY REFINEMENT: When input category is 'celebrity', set to "
    "'celebrity' for personal drama or 'entertainment' for movie/show/music. "
    "Omit for all others.\n\n"
    "ALWAYS reply with a single JSON object - no prose, no markdown fences - "
    "with keys: storySummary, lifeImpact, walletImpact (string|null), insight, "
    "ticker (string|null), companyName (string|null), category (string, optional)."
)

SENTIMENT_SYSTEM_PROMPT = (
    "You analyze social media sentiment about news stories for CRRNT - an app "
    "that makes the news feel personal and real.\n\n"
    "The story below is a real news story CRRNT is publishing today (see the "
    "date given in the user message). Use the x_search tool to find posts on X "
    "about it, then write a casual honest summary of how everyday people are "
    "actually reacting - not Wall Street, not pundits, not politicians. How are "
    "real people feeling? Angry? Worried? Relieved? Unbothered? Be direct and "
    "specific. Avoid corporate tone entirely.\n\n"
    "Search decisively: run 1-3 searches, favoring the most recent posts "
    "relative to today's date, then read what you found and commit to a read "
    "of the room. Do not keep re-searching to find a 'perfect' match - if you "
    "found real, relevant posts (even a modest number), use them. Topics like "
    "the Fed, elections, or recurring events happen repeatedly - always anchor "
    "to the most recent matching posts, not older cycles of the same story.\n\n"
    "IMPORTANT: Use plain ASCII text only. No smart quotes, no curly quotes, "
    "no em dashes, no en dashes, no ellipsis characters, no Unicode punctuation. "
    "Use straight quotes (\"), hyphens (-), and three dots (...) instead.\n\n"
    "sentimentLabel must be exactly one of: "
    "'mostly positive' | 'mostly frustrated' | 'split' | 'surprisingly calm' "
    "| 'not enough data'\n\n"
    "Only use 'not enough data' if your searches genuinely turn up nothing "
    "relevant - no posts at all about this story or topic. Finding some posts, "
    "even a small number, is enough to make a call. Do not use 'not enough "
    "data' just because opinions are mixed - that is what 'split' is for.\n\n"
    "sentimentScore is a float from -1.0 (very negative) to 1.0 (very positive), "
    "or null if sentimentLabel is 'not enough data'.\n\n"
    "peopleSay (2-3 sentences, max 280 characters): capture the actual vibe "
    "of the conversation in plain casual language. What is the dominant feeling "
    "and why? If opinions are split, say who is on each side in plain terms. "
    "Null if sentimentLabel is 'not enough data'.\n\n"
    "featuredPosts: an array of 2-4 real posts from your search that best "
    "represent the range of reaction (pick ones that support your peopleSay "
    "summary - if opinions are split, include posts from both sides). Empty "
    "array if sentimentLabel is 'not enough data'. Each item is an object "
    "with keys: handle (string, the poster's @handle without the @ sign, "
    "exactly as it appeared in the post you read - never invent one), "
    "text (string, max 200 characters - quote or closely paraphrase what "
    "they actually said, do not fabricate), url (string, the exact post URL "
    "from your search results for this specific post).\n\n"
    "ALWAYS reply with a single JSON object - no prose, no markdown - "
    "with keys: sentimentLabel (string), sentimentScore (float|null), "
    "peopleSay (string|null), featuredPosts (array)."
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

    wallet_impact = _sanitize(parsed.get("walletImpact") or "") or None

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
    })
    log.info("Pass 1 done: '%s' ticker=%s", title[:60], ticker or "none")
    return story


async def enrich_story_tweets(story: dict[str, Any]) -> dict[str, Any]:
    """Pass 2: Grok searches X directly and analyzes sentiment in one call."""
    title = story.get("title", "")
    ticker = story.get("ticker", "")
    summary = story.get("storySummary") or story.get("description") or ""
    people = story.get("people") or []
    topics = story.get("topics") or []

    today = datetime.now(timezone.utc)
    user_prompt = (
        f"Today's date: {today.strftime('%Y-%m-%d')}\n"
        f"Article: {title}\nTicker: {ticker or 'N/A'}\n"
        f"People: {', '.join(people) or 'N/A'}\nTopics: {', '.join(topics) or 'N/A'}\n"
        f"Summary: {summary[:300]}\n\n"
        "Search X for how people are reacting to this story, then reply with JSON only."
    )

    real_urls: set[str] = set()
    try:
        client = _get_xai_client()
        chat = client.chat.create(
            model=GROK_MODEL,
            tools=[x_search(from_date=today - timedelta(days=14))],
            max_tokens=2000,
        )
        chat.append(xai_system(SENTIMENT_SYSTEM_PROMPT))
        chat.append(xai_user(user_prompt))
        response = await chat.sample()
        parsed = _parse_json(response.content or "")
        real_urls = {_status_id(c) for c in (response.citations or []) if c}
        real_urls.discard(None)
    except Exception as exc:
        log.warning("Tweet sentiment failed for '%s': %s", title[:60], exc)
        parsed = {}

    label = parsed.get("sentimentLabel") or "not enough data"
    score = parsed.get("sentimentScore")
    if label == "not enough data":
        score = None
    elif score is not None:
        try:
            score = max(-1.0, min(1.0, float(score)))
        except (TypeError, ValueError):
            score = None

    featured_posts: list[dict[str, str]] = []
    if label != "not enough data":
        for post in (parsed.get("featuredPosts") or [])[:4]:
            if not isinstance(post, dict):
                continue
            url = (post.get("url") or "").strip()
            handle = _sanitize((post.get("handle") or "").strip().lstrip("@"))
            text = _sanitize((post.get("text") or "").strip())[:200]
            if not (url and handle and text):
                continue
            if real_urls and _status_id(url) not in real_urls:
                # Grok hallucinated a URL not present in its own search results - drop it.
                continue
            featured_posts.append({"handle": handle, "text": text, "url": url})

    story.update({
        "sentimentLabel": label,
        "sentimentScore": score,
        "peopleSay": _sanitize(parsed.get("peopleSay") or "") or None,
        "featuredPosts": featured_posts,
    })
    return story


def _status_id(url: str) -> Optional[str]:
    """Extract the numeric status ID from an x.com/twitter.com post URL.

    Grok's citations use the anonymized form (x.com/i/status/{id}) while its
    JSON answer tends to quote the display form (x.com/{handle}/status/{id})
    for the same post, so IDs - not full URL strings - are the reliable key.
    """
    match = re.search(r"/status/(\d+)", url)
    return match.group(1) if match else None


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


# ── Pass 2b: StockTwits ticker sentiment ────────────────────────────────
# Cheap replacement for the Grok pass, used only when a story HAS a ticker:
#   1. Pull the ticker's recent StockTwits stream (public endpoint, no auth).
#   2. Keep only the posts that actually relate to THIS story. A ticker
#      stream is about the ticker in general, so the ticker itself never
#      counts as a relevance hit — otherwise every post would match and the
#      sentiment would describe the ticker, not the story.
#   3. Haiku reads the survivors and returns the same sentiment fields the
#      Grok pass returns, so the DB and the app need no changes.
# Featured-post URLs point at StockTwits, and the prompt forbids claiming
# they are X/Twitter posts. If nothing relevant survives, the story gets
# "not enough data", exactly like a Grok pass that found nothing.
STOCKTWITS_STREAM_URL = (
    "https://api.stocktwits.com/api/2/streams/symbol/{ticker}.json"
)
STOCKTWITS_POST_URL = "https://stocktwits.com/{username}/status/{message_id}"
_SOCIAL_STREAM_LIMIT = 30
_SOCIAL_MAX_POSTS = 12
_SOCIAL_KEYWORD_STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
    "by", "at", "from", "as", "is", "are", "was", "were", "it", "its",
    "this", "that", "after", "amid", "into", "over", "per", "via",
    "says", "say", "new", "more", "than", "but", "not", "has", "have",
}

SOCIAL_SENTIMENT_SYSTEM_PROMPT = (
    "You analyze social media sentiment about news stories for CRRNT - an app "
    "that makes the news feel personal and real.\n\n"
    "The posts below come from StockTwits users discussing this ticker. "
    "First decide which posts are actually about THIS story, not just the "
    "ticker in general - ignore posts that only mention the ticker without "
    "touching the story's topic. Then write a casual honest summary of how "
    "everyday people are actually reacting in the relevant posts - not Wall "
    "Street, not pundits. How are real people feeling? Angry? Worried? "
    "Relieved? Unbothered? Be direct and specific. Avoid corporate tone "
    "entirely. Never claim these are X/Twitter posts - they are StockTwits "
    "posts, and the summary must not name a platform at all.\n\n"
    "IMPORTANT: Use plain ASCII text only. No smart quotes, no curly quotes, "
    "no em dashes, no en dashes, no ellipsis characters, no Unicode "
    "punctuation. Use straight quotes (\"), hyphens (-), and three dots "
    "(...) instead.\n\n"
    "sentimentLabel must be exactly one of: "
    "'mostly positive' | 'mostly frustrated' | 'split' | 'surprisingly calm' "
    "| 'not enough data'\n\n"
    "Only use 'not enough data' if none of the supplied posts are actually "
    "about this story. Finding some relevant posts, even a small number, is "
    "enough to make a call. Do not use 'not enough data' just because "
    "opinions are mixed - that is what 'split' is for.\n\n"
    "sentimentScore is a float from -1.0 (very negative) to 1.0 (very "
    "positive), or null if sentimentLabel is 'not enough data'.\n\n"
    "peopleSay (2-3 sentences, max 280 characters): capture the actual vibe "
    "of the conversation in plain casual language. What is the dominant "
    "feeling and why? If opinions are split, say who is on each side in "
    "plain terms. Null if sentimentLabel is 'not enough data'.\n\n"
    "featuredPosts: an array of 2-4 posts from the supplied list that best "
    "represent the range of reaction (pick ones that support your peopleSay "
    "summary - if opinions are split, include posts from both sides). Empty "
    "array if sentimentLabel is 'not enough data'. Each item is an object "
    "with keys: handle (string, exactly as given - never invent one), "
    "text (string, max 200 characters - quote or closely paraphrase what "
    "they actually said, do not fabricate), url (string, exactly as given "
    "for this specific post - never invent one).\n\n"
    "ALWAYS reply with a single JSON object - no prose, no markdown - "
    "with keys: sentimentLabel (string), sentimentScore (float|null), "
    "peopleSay (string|null), featuredPosts (array)."
)


def _social_keywords(story: dict[str, Any]) -> set[str]:
    """Keywords that tie a post to THIS story (never the ticker itself)."""
    raw_parts = [story.get("title") or "", story.get("companyName") or ""]
    raw_parts.extend(story.get("topics") or [])
    raw_parts.extend(story.get("people") or [])
    keywords: set[str] = set()
    for part in raw_parts:
        for token in re.findall(r"[a-z0-9]+", str(part).lower()):
            if len(token) >= 3 and token not in _SOCIAL_KEYWORD_STOPWORDS:
                keywords.add(token)
    ticker = (story.get("ticker") or "").strip().lower()
    if ticker:
        keywords.discard(ticker)
        keywords.discard(ticker.replace(".", ""))
    return keywords


async def fetch_stocktwits_posts(ticker: str) -> list[dict[str, Any]]:
    """Recent StockTwits messages for a ticker (public endpoint, no auth)."""
    url = STOCKTWITS_STREAM_URL.format(ticker=ticker)
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url, params={"limit": _SOCIAL_STREAM_LIMIT})
            if resp.status_code != 200:
                log.warning("StockTwits stream %s -> HTTP %s", ticker, resp.status_code)
                return []
            data = resp.json()
    except Exception as exc:
        log.warning("StockTwits fetch failed for %s: %s", ticker, exc)
        return []
    posts: list[dict[str, Any]] = []
    for msg in data.get("messages") or []:
        user = msg.get("user") or {}
        handle = (user.get("username") or "").strip()
        text = (msg.get("body") or "").strip()
        msg_id = msg.get("id")
        if not (handle and text and msg_id):
            continue
        posts.append({
            "handle": handle,
            "text": text,
            "url": STOCKTWITS_POST_URL.format(username=handle, message_id=msg_id),
            "created_at": msg.get("created_at") or "",
        })
    return posts


def select_relevant_posts(
    posts: list[dict[str, Any]],
    story: dict[str, Any],
    max_posts: int = _SOCIAL_MAX_POSTS,
) -> list[dict[str, Any]]:
    """Keep only posts that mention the story's topic, newest-first on ties."""
    keywords = _social_keywords(story)
    if not keywords:
        return []
    scored: list[tuple[int, str, dict[str, Any]]] = []
    for post in posts:
        tokens = set(re.findall(r"[a-z0-9]+", post.get("text", "").lower()))
        hits = len(keywords & tokens)
        if hits:
            scored.append((hits, post.get("created_at") or "", post))
    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [post for _, _, post in scored[:max_posts]]


async def analyze_social_sentiment(
    story: dict[str, Any], posts: list[dict[str, Any]]
) -> dict[str, Any]:
    """Haiku pass over the relevant posts; same output shape as Grok."""
    title = story.get("title") or ""
    summary = story.get("storySummary") or story.get("description") or ""
    listed = "\n".join(
        f"{i + 1}. @{p['handle']}: {p['text'][:300]} (url: {p['url']})"
        for i, p in enumerate(posts)
    )
    user_prompt = (
        f"Story: {title}\nSummary: {summary[:300]}\n\n"
        f"Posts about this ticker:\n{listed}\n\n"
        "Decide which posts are actually about this story, then reply "
        "with JSON only."
    )
    try:
        client = _get_client()
        msg = await client.messages.create(
            model=MODEL,
            max_tokens=1000,
            temperature=0,
            system=SOCIAL_SENTIMENT_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = "".join(
            b.text for b in msg.content if getattr(b, "type", "") == "text"
        )
        parsed = _parse_json(text)
    except Exception as exc:
        log.warning("Social sentiment failed for '%s': %s", title[:60], exc)
        parsed = {}

    label = parsed.get("sentimentLabel") or "not enough data"
    score = parsed.get("sentimentScore")
    if label == "not enough data":
        score = None
    elif score is not None:
        try:
            score = max(-1.0, min(1.0, float(score)))
        except (TypeError, ValueError):
            score = None

    allowed_urls = {p["url"] for p in posts}
    featured_posts: list[dict[str, str]] = []
    if label != "not enough data":
        for post in (parsed.get("featuredPosts") or [])[:4]:
            if not isinstance(post, dict):
                continue
            url = (post.get("url") or "").strip()
            handle = _sanitize((post.get("handle") or "").strip().lstrip("@"))
            text = _sanitize((post.get("text") or "").strip())[:200]
            if not (url and handle and text):
                continue
            if url not in allowed_urls:
                # Haiku cited a post it was not given - drop it.
                continue
            featured_posts.append({"handle": handle, "text": text, "url": url})

    return {
        "sentimentLabel": label,
        "sentimentScore": score,
        "peopleSay": _sanitize(parsed.get("peopleSay") or "") or None,
        "featuredPosts": featured_posts,
    }


async def enrich_story_social(story: dict[str, Any]) -> dict[str, Any]:
    """Pass 2b: StockTwits fetch + relevance filter + Haiku sentiment."""
    title = story.get("title") or ""
    ticker = (story.get("ticker") or "").strip().upper()
    result = {
        "sentimentLabel": "not enough data",
        "sentimentScore": None,
        "peopleSay": None,
        "featuredPosts": [],
    }
    if not ticker:
        story.update(result)
        return story
    posts = await fetch_stocktwits_posts(ticker)
    relevant = select_relevant_posts(posts, story)
    if not relevant:
        log.info("Social sentiment: no relevant posts for '%s'", title[:60])
        story.update(result)
        return story
    log.info(
        "Social sentiment: %d/%d relevant posts for '%s'",
        len(relevant), len(posts), title[:60],
    )
    analyzed = await analyze_social_sentiment(story, relevant)
    story.update({
        "sentimentLabel": analyzed["sentimentLabel"],
        "sentimentScore": analyzed["sentimentScore"],
        "peopleSay": analyzed["peopleSay"],
        "featuredPosts": analyzed["featuredPosts"],
    })
    return story


def _is_buzzfeed_quiz(story: dict[str, Any]) -> bool:
    source = (story.get("source") or "").strip().lower()
    title = (story.get("title") or "").strip().lower()
    return "buzzfeed" in source and "quiz" in title


# Categories where social sentiment is either predictable (everyone feels the
# same about a natural disaster) or low-value to surface (a health crisis
# isn't "controversial") - skip the Grok sentiment pass there entirely to cut
# cost. Keep it for categories where opinion is genuinely split: government,
# business, celebrity, sports, tech, science, entertainment.
_SENTIMENT_SKIP_CATEGORIES = {"world", "health"}


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
    sem1 = asyncio.Semaphore(MAX_CONCURRENCY)

    async def _bounded_enrich(s: dict[str, Any]) -> dict[str, Any]:
        async with sem1:
            return await enrich_story(s)

    enriched = list(await asyncio.gather(*[_bounded_enrich(s) for s in stories]))

    sem2 = asyncio.Semaphore(MAX_CONCURRENCY_TWEETS)

    async def _bounded_tweets(s: dict[str, Any]) -> dict[str, Any]:
        if _is_buzzfeed_quiz(s):
            return s
        if (s.get("category") or "").strip().lower() in _SENTIMENT_SKIP_CATEGORIES:
            return s
        if s.get("ticker"):
            # Ticker stories use the StockTwits + Haiku flow, not Grok.
            async with sem2:
                return await enrich_story_social(s)
        if not (s.get("people") or s.get("topics")):
            return s
        async with sem2:
            return await enrich_story_tweets(s)

    enriched = list(await asyncio.gather(*[_bounded_tweets(s) for s in enriched]))
    return enriched
