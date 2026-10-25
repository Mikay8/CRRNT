"""RSS feed client — CRRNT's only news source.

Each CRRNT category pulls from a handful of publisher RSS feeds. The live
feed list is admin-managed (add / remove / toggle per category on the
Settings page, stored via app_settings.get_rss_feeds); DEFAULT_FEEDS below is
only the starting set used before an admin first saves. Feeds give us
headline, short dek, link, publish date and (usually) an image — not the full
article body. We deliberately only use the feed's short `summary`, never
`content:encoded`, so we aren't storing or enriching full copyrighted text.
Every story links back to the publisher via source_url.

There's no shared rate limit, but we still cap concurrency and send an
identifying User-Agent to be a polite client.
"""
from __future__ import annotations

import asyncio
import html
import logging
import re
from calendar import timegm
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlparse

import feedparser
import httpx

log = logging.getLogger("crrnt.rss")

_USER_AGENT = "CRRNT-Bot/1.0 (+https://crrnt.app)"
_MAX_CONCURRENCY = 6
_MAX_DEK_CHARS = 500

DEFAULT_FEEDS: dict[str, list[dict[str, str]]] = {
    "celebrity": [
        {"name": "E! Online", "url": "https://www.eonline.com/syndication/feeds/rssfeeds/topstories.xml"},
        {"name": "Variety", "url": "https://variety.com/feed/"},
        {"name": "Billboard", "url": "https://www.billboard.com/feed/"},
        {"name": "Entertainment Tonight", "url": "https://www.etonline.com/news/rss"},
    ],
    "tech": [
        {"name": "The Verge", "url": "https://www.theverge.com/rss/index.xml"},
        {"name": "TechCrunch", "url": "https://techcrunch.com/feed/"},
        {"name": "Ars Technica", "url": "https://feeds.arstechnica.com/arstechnica/index"},
        {"name": "Wired", "url": "https://www.wired.com/feed/rss"},
    ],
    "government": [
        {"name": "NPR Politics", "url": "https://feeds.npr.org/1014/rss.xml"},
        {"name": "Politico", "url": "https://rss.politico.com/politics-news.xml"},
        {"name": "The Hill", "url": "https://thehill.com/homenews/feed/"},
    ],
    "sports": [
        {"name": "ESPN", "url": "https://www.espn.com/espn/rss/news"},
        {"name": "CBS Sports", "url": "https://www.cbssports.com/rss/headlines/"},
        {"name": "BBC Sport", "url": "https://feeds.bbci.co.uk/sport/rss.xml"},
    ],
    "business": [
        {"name": "NPR Business", "url": "https://feeds.npr.org/1006/rss.xml"},
        {"name": "CNBC", "url": "https://www.cnbc.com/id/10001147/device/rss/rss.html"},
        {"name": "BBC Business", "url": "https://feeds.bbci.co.uk/news/business/rss.xml"},
    ],
    "science": [
        {"name": "ScienceDaily", "url": "https://www.sciencedaily.com/rss/top/science.xml"},
        {"name": "NPR Science", "url": "https://feeds.npr.org/1007/rss.xml"},
        {"name": "Space.com", "url": "https://www.space.com/feeds/all"},
    ],
    "world": [
        {"name": "BBC World", "url": "https://feeds.bbci.co.uk/news/world/rss.xml"},
        {"name": "NPR World", "url": "https://feeds.npr.org/1004/rss.xml"},
        {"name": "Al Jazeera", "url": "https://www.aljazeera.com/xml/rss/all.xml"},
        {"name": "The Guardian", "url": "https://www.theguardian.com/world/rss"},
    ],
    "health": [
        {"name": "NPR Health", "url": "https://feeds.npr.org/1128/rss.xml"},
        {"name": "STAT News", "url": "https://www.statnews.com/feed/"},
        {"name": "ScienceDaily Health", "url": "https://www.sciencedaily.com/rss/health_medicine.xml"},
    ],
}

CATEGORIES: list[str] = list(DEFAULT_FEEDS)

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
_IMG_RE = re.compile(r"<img[^>]+src=[\"']([^\"']+)[\"']", re.IGNORECASE)


def _strip_html(text: str) -> str:
    return _WS_RE.sub(" ", html.unescape(_TAG_RE.sub(" ", text))).strip()


def _domain(url: str) -> str:
    host = urlparse(url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def _published_iso(entry: Any) -> str:
    parsed = entry.get("published_parsed") or entry.get("updated_parsed")
    if not parsed:
        return ""
    return datetime.fromtimestamp(timegm(parsed), tz=timezone.utc).isoformat()


def _image(entry: Any) -> Optional[str]:
    for key in ("media_content", "media_thumbnail"):
        for m in entry.get(key) or []:
            if m.get("url"):
                return m["url"]
    for link in entry.get("links") or []:
        if link.get("rel") == "enclosure" and (link.get("type") or "").startswith("image/"):
            return link.get("href")
    # Many feeds (NPR, The Verge) only embed the lead image in the HTML body.
    # Reading it for the image URL is fine — the body text itself is discarded.
    for blob in [entry.get("summary") or ""] + [c.get("value") or "" for c in entry.get("content") or []]:
        m = _IMG_RE.search(blob)
        if m:
            return html.unescape(m.group(1))
    return None


def _normalize(entry: Any, crrnt_category: str) -> dict[str, Any]:
    link = entry.get("link") or ""
    dek = _strip_html(entry.get("summary") or "")
    if len(dek) > _MAX_DEK_CHARS:
        dek = dek[:_MAX_DEK_CHARS].rsplit(" ", 1)[0] + "…"
    tags = [t.get("term") for t in entry.get("tags") or [] if t.get("term")]
    author = entry.get("author")

    return {
        "articleId": str(entry.get("id") or link),
        "title": _strip_html(entry.get("title") or ""),
        "description": dek,
        "link": link,
        "mediaUrl": _image(entry),
        "publishedDate": _published_iso(entry),
        "source": _domain(link),
        "category": crrnt_category,
        "topics": tags,
        "people": [],
        "authors": [author] if author else [],
    }


async def _fetch_feed(
    client: httpx.AsyncClient, sem: asyncio.Semaphore, url: str, crrnt_category: str
) -> list[dict[str, Any]]:
    async with sem:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
        except Exception as exc:  # noqa: BLE001
            log.info("RSS fetch failed for %s: %s", url, exc)
            return []
    parsed = await asyncio.to_thread(feedparser.parse, resp.content)
    if parsed.bozo and not parsed.entries:
        log.info("RSS parse failed for %s: %s", url, parsed.get("bozo_exception"))
        return []
    return [_normalize(e, crrnt_category) for e in parsed.entries if e.get("link")]


async def fetch_categories_with_map(
    per_category_map: dict[str, int],
    *,
    feeds: Optional[dict[str, list[dict[str, Any]]]] = None,
) -> list[dict[str, Any]]:
    """Fetch every enabled feed for the requested categories and keep the
    newest `count` stories per category, round-robined across that
    category's feeds so one prolific publisher can't fill the whole slot.

    feeds: {cat: [{name, url, enabled}]} from app_settings.get_rss_feeds();
    defaults to DEFAULT_FEEDS.
    """
    feeds = feeds if feeds is not None else DEFAULT_FEEDS
    feeds_by_cat = {
        cat: [f["url"] for f in feeds.get(cat, []) if f.get("enabled", True)]
        for cat in per_category_map
    }
    sem = asyncio.Semaphore(_MAX_CONCURRENCY)
    async with httpx.AsyncClient(
        timeout=20.0, follow_redirects=True, headers={"User-Agent": _USER_AGENT}
    ) as client:
        jobs = {
            (cat, url): _fetch_feed(client, sem, url, cat)
            for cat, urls in feeds_by_cat.items()
            for url in urls
        }
        results = dict(zip(jobs.keys(), await asyncio.gather(*jobs.values())))

    seen: set[str] = set()
    flattened: list[dict[str, Any]] = []
    for cat, count in per_category_map.items():
        per_feed = []
        for url in feeds_by_cat[cat]:
            arts = sorted(
                results.get((cat, url), []),
                key=lambda a: a["publishedDate"],
                reverse=True,
            )
            per_feed.append(arts)

        picked: list[dict[str, Any]] = []
        idx = 0
        while len(picked) < count and any(idx < len(f) for f in per_feed):
            for feed_arts in per_feed:
                if idx < len(feed_arts) and len(picked) < count:
                    art = feed_arts[idx]
                    key = art["link"]
                    if key not in seen:
                        seen.add(key)
                        picked.append(art)
            idx += 1
        log.info("RSS: %d article(s) picked for category '%s'", len(picked), cat)
        flattened.extend(picked)

    log.info("RSS: fetch complete — %d unique articles", len(flattened))
    return flattened


async def check_feed(url: str) -> dict[str, Any]:
    """Fetch and parse a feed an admin wants to add, so a typo'd or non-RSS
    URL is rejected up front instead of silently yielding nothing at 6 AM.

    Returns {"ok": True, "title": str, "entries": int} or
    {"ok": False, "error": str}.
    """
    try:
        async with httpx.AsyncClient(
            timeout=20.0, follow_redirects=True, headers={"User-Agent": _USER_AGENT}
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Couldn't fetch the URL ({exc.__class__.__name__})"}
    parsed = await asyncio.to_thread(feedparser.parse, resp.content)
    entries = [e for e in parsed.entries if e.get("link")]
    if not entries:
        return {"ok": False, "error": "That URL doesn't look like an RSS/Atom feed (no stories found)"}
    # Feed titles often carry a tagline ("Engadget - Technology News & ...").
    title = re.split(r"\s+[-|–]\s+", _strip_html(parsed.feed.get("title") or ""))[0] or _domain(url)
    return {"ok": True, "title": title, "entries": len(entries)}


__all__ = ["CATEGORIES", "DEFAULT_FEEDS", "check_feed", "fetch_categories_with_map"]
