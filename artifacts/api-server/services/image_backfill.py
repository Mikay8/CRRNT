"""One-click backfill: give every existing story a Pixabay image.

The admin Settings page has a "Backfill story images from Pixabay"
button for stories that predate the Pixabay provider (PR #78) — or
whose stored image URL points anywhere other than CRRNT's own image
route. For each such story this:

  1. asks Claude (Haiku) for the story's subject search phrase, under
     the same rules as Pass 1's imageQuery: 2-6 concrete words, never
     a person's name, never a person standing in for someone;
  2. searches Pixabay by that subject (generic category query as the
     fallback), downloads the photo into CRRNT's S3 bucket, and
     points the story at /api/stories/{id}/image with Pixabay
     credits — exactly the state ingestion now produces.

Deliberate exclusions:
- image_source='manual' stories are admin hand-edits (PR #61) and are
  never overwritten.
- Stories already on a self-hosted Pixabay image (media_url is the
  /image route) are skipped, so re-running is cheap and safe —
  UNLESS an earlier (newer) story in the same run holds the same
  photo: duplicate holders are re-picked from the unused search
  results, because one photo never illustrates two stories.

Per-story failures degrade to "story untouched" and are counted in
the run summary; nothing raises out of the run. Sequential with a
short pause between stories — the Pixabay key allows 100 requests
per 60 seconds and a full feed is ~60 stories.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from services import db, enrichment, pixabay_images, story_images

log = logging.getLogger("crrnt.image_backfill")

_running = False

_QUERY_SYSTEM = (
    "You pick a stock-photo search phrase for a news story. Reply with "
    "a JSON object only: {\"imageQuery\": \"...\"}.\n"
    "imageQuery is the story's concrete visual subject in 2 to 5 plain "
    "words (e.g. \"concert stage lights\", \"electric vehicle charging\", "
    "\"basketball arena\"). It must NEVER contain a person's name. "
    "CRITICAL: if the story is about a specific named person, the "
    "query must not describe a person at all — no \"politician "
    "speaking\", \"rally speaker\", \"singer performing\", \"athlete "
    "celebrating\". Stock sites tag photos of FAMOUS people with "
    "generic words, so a person-describing query returns a real, "
    "recognizable person who is not the story's subject — the worst "
    "possible image. Search their world instead: a place, building, "
    "object, or crowd with no single subject (a singer → \"concert "
    "stage lights\"; a campaigning senator → \"united states capitol "
    "building\" or \"rally crowd waving flags\"). No abstract concepts "
    "(\"justice\", \"the economy\"), no brands unless the brand's "
    "product is the subject."
)


async def derive_image_query(story: dict[str, Any]) -> Optional[str]:
    """Claude-derived subject phrase for an already-enriched story.
    None on any failure — the caller falls back to the category query."""
    headline = story.get("display_title") or story.get("title") or ""
    summary = story.get("summary") or ""
    if not headline:
        return None
    user_prompt = (
        f"Category: {story.get('category') or ''}\n"
        f"Headline: {headline}\nSummary: {summary}\n\n"
        "Reply with the JSON object only."
    )
    try:
        client = enrichment._get_client()
        msg = await client.messages.create(
            model=enrichment.MODEL,
            max_tokens=120,
            system=_QUERY_SYSTEM,
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = "".join(
            b.text for b in msg.content if getattr(b, "type", "") == "text"
        )
        parsed = enrichment._parse_json(text)
    except Exception as exc:
        log.warning("Backfill query derivation failed for %r: %s", headline[:60], exc)
        return None
    return enrichment._clean_image_query(parsed.get("imageQuery"))


def needs_backfill(story: dict[str, Any], claimed: Any = frozenset()) -> bool:
    """True unless the story already shows a properly hosted Pixabay
    image that no earlier story in this run has claimed. A
    Pixabay-flagged story whose media_url is NOT the /image route
    (e.g. an external URL set by hand) still needs backfilling — that
    URL is not served from CRRNT storage. And a hosted Pixabay story
    whose photo was already claimed by a newer story is a duplicate
    holder: it needs a fresh pick, because one photo never illustrates
    two stories."""
    if story.get("image_source") == "manual":
        return False
    media_url = story.get("media_url") or ""
    if story.get("image_source") == "pixabay" and "/image" in media_url:
        return (story.get("image_credit_url") or "") in claimed
    return True


async def backfill_story(
    story: dict[str, Any], exclude: Any = ()
) -> tuple[str, Optional[str]]:
    """Replace one story's image with a hosted Pixabay photo, never
    one whose credit URL is in `exclude`. Returns (outcome,
    credit_url): outcome is 'updated', 'no_image', or 'failed';
    credit_url is the newly stored photo's URL on 'updated'."""
    story_id = str(story["id"])
    query = await derive_image_query(story)
    hit = await story_images.find_for_story(
        "pixabay", query, story.get("category"), exclude=exclude
    )
    if not hit:
        log.info("Backfill: no Pixabay image for story %s (query %r)", story_id, query)
        return "no_image", None
    hosted = await story_images.host_pixabay_image(story_id, hit)
    if not hosted:
        log.warning("Backfill: hosting failed for story %s", story_id)
        return "failed", None
    await db.update_story_image(
        story_id,
        hosted["media_url"],
        hosted.get("credit_name"),
        hosted.get("credit_url"),
        "pixabay",
    )
    log.info(
        "Backfill: story %s now on Pixabay (query %r, credit %s)",
        story_id, query, hosted.get("credit_name"),
    )
    return "updated", hosted.get("credit_url")


async def repull_story_image(story: dict[str, Any]) -> str:
    """Replace ONE story's image with a fresh Pixabay photo — the
    admin Edit image panel's "Re-pull from Pixabay" action. The search
    excludes every photo already used by another story in the feed
    AND this story's current photo, so a re-pull always lands on a
    different, unused image (never a duplicate, never the same photo
    again). Returns 'updated', 'no_image', 'failed', or
    'not_configured'; on anything but 'updated' the story is left
    exactly as it was."""
    if not pixabay_images.is_configured():
        log.warning(
            "Re-pull refused for story %s — PIXABAY_API_KEY is not set",
            story.get("id"),
        )
        return "not_configured"
    used = await db.get_used_pixabay_credit_urls()
    own = story.get("image_credit_url")
    if own:
        used.add(own)
    try:
        outcome, _ = await backfill_story(story, exclude=used)
    except Exception as exc:
        log.warning("Re-pull failed for story %s: %s", story.get("id"), exc)
        return "failed"
    return outcome


async def run_backfill() -> dict[str, Any]:
    """Backfill every story that needs one. Safe to re-run; a second
    concurrent run is refused. Returns (and logs) the run summary."""
    global _running
    if _running:
        log.warning("Backfill refused — a run is already in progress")
        return {"error": "already running"}
    if not pixabay_images.is_configured():
        log.error("Backfill aborted — PIXABAY_API_KEY is not set")
        return {"error": "PIXABAY_API_KEY is not set"}
    _running = True
    stats = {"considered": 0, "updated": 0, "deduped": 0, "no_image": 0,
             "failed": 0, "skipped": 0}
    # Photos already spoken for, newest story first (get_stories is
    # published-desc): the first story to hold a photo keeps it, and
    # any later story showing the same photo is re-picked from the
    # unused results instead of repeating it.
    claimed: set[str] = set()
    try:
        stories = await db.get_stories(limit=500)
        for story in stories:
            credit_url = story.get("image_credit_url") or ""
            hosted_pixabay = (
                story.get("image_source") == "pixabay"
                and "/image" in (story.get("media_url") or "")
            )
            if not needs_backfill(story, claimed):
                if credit_url:
                    claimed.add(credit_url)
                stats["skipped"] += 1
                continue
            stats["considered"] += 1
            if hosted_pixabay:
                stats["deduped"] += 1
            try:
                outcome, new_credit_url = await backfill_story(
                    story, exclude=claimed
                )
            except Exception as exc:
                log.warning("Backfill failed for story %s: %s", story.get("id"), exc)
                outcome, new_credit_url = "failed", None
            if new_credit_url:
                claimed.add(new_credit_url)
            stats[outcome] += 1
            await asyncio.sleep(0.3)
    finally:
        _running = False
    log.info(
        "Backfill complete: %(considered)d considered, %(updated)d updated "
        "(%(deduped)d duplicate holders among the considered), "
        "%(no_image)d no image found, %(failed)d failed, %(skipped)d skipped",
        stats,
    )
    return stats
