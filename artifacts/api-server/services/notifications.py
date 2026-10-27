"""CRRNT push notifications — the newspaper voice.

Two triggers, both broadcast (send_push sends to every stored token; there
is no per-user targeting yet):

- Morning Edition (daily 7:30am ET, scheduler job): "Hot off the press 🗞️"
  plus the top newly-inserted story's one-liner as the blurb. Fires only
  when the last 12 hours actually produced stories.
- Breaking news (admin publishes in the portal): the hook comes from the
  admin "Breaking news alert style" setting — "Stop the presses!",
  "Extra! Extra!", or "alternate", which flips between the two on every
  send (the flip is persisted in app_settings so it survives restarts).

Taps: the app routes both types to the feed for now (see
app/_layout.tsx NotificationTapRouter). Breaking cards render at the top
of the feed, so the feed is the right destination until breaking items can
link a CRRNT story directly.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from services import app_settings, push

log = logging.getLogger("crrnt.notifications")

HOOK_STOP = "Stop the presses!"
HOOK_EXTRA = "Extra! Extra!"
MORNING_TITLE = "Hot off the press 🗞️"
MORNING_WINDOW_HOURS = 12


async def next_breaking_hook() -> str:
    """Resolve the breaking hook for this send, flipping the stored state
    when the mode is 'alternate'."""
    style = await app_settings.get_breaking_style()
    mode = style.get("mode", "alternate")
    if mode == "stop":
        return HOOK_STOP
    if mode == "extra":
        return HOOK_EXTRA
    # Alternate: opposite of whatever went out last (first send: Stop).
    last = style.get("last_hook")
    hook = HOOK_EXTRA if last == "stop" else HOOK_STOP
    await app_settings.save_breaking_style(
        "alternate", "extra" if hook == HOOK_EXTRA else "stop"
    )
    return hook


async def send_breaking_push(headline: str) -> None:
    """Immediate push for an admin-published breaking item. The headline IS
    the blurb — breaking items have no blurb field."""
    hook = await next_breaking_hook()
    await push.send_push(hook, headline, data={"type": "breaking"})
    log.info("Breaking push sent: hook=%r headline=%r", hook, headline[:80])


async def send_morning_digest_push() -> None:
    """7:30am ET digest push. Stories are picked by insertion time
    (created_at), not publish date — ingestion inserts stories published up
    to 3 days ago, so 'published today' would miss most of the morning run.
    """
    try:
        from services import db

        cutoff = datetime.now(timezone.utc) - timedelta(hours=MORNING_WINDOW_HOURS)
        stories = await db.get_recently_inserted_stories(cutoff, limit=50)
    except Exception as exc:
        log.warning("Morning digest push skipped — story fetch failed: %s", exc)
        return
    if not stories:
        log.info("Morning digest push skipped — no stories inserted in the last %dh", MORNING_WINDOW_HOURS)
        return

    top = stories[0]
    blurb = top.get("one_liner") or top.get("title") or "Your Morning Edition is ready."
    if len(stories) > 1:
        body = f"{blurb} Plus {len(stories) - 1} more stories in your Morning Edition."
    else:
        body = blurb
    await push.send_push(MORNING_TITLE, body, data={"type": "digest"})
    log.info("Morning digest push sent: %d stories, top=%r", len(stories), (top.get("title") or "")[:80])
