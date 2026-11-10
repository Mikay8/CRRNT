"""Same-event dedup for ingestion winners, before enrichment.

The ranker already groups duplicate events — but only inside one
category's candidate batch in one run. That leaves three holes, all
seen live on 2026-11-09 (five tellings of the Nvidia CEO spy/affair
story in the feed at once, published Nov 6/7/8/8/9):

- across DAYS: an event already live in the feed is never compared
  against today's winners, so an unfolding story re-enters daily;
- across CATEGORIES: per-category ranking is blind across the
  boundary (the same Tesla production story ran in Business AND
  Tech);
- a grouping miss inside one batch lets two tellings through.

This pass runs once per ingestion run, after ranking and before
enrichment (so dropped duplicates never cost Pass 1 / sentiment /
TTS spend). One batched Haiku call sees the day's winners (all
categories together) plus the headlines of everything currently
live in the feed, and groups them by underlying event.

Policy — FIRST TELLING WINS (Mikayla's call, 2026-11-09): a story
already live in the feed beats any new candidate for the same
event; among new candidates for one event, the first in ranked
order wins. Later developments of an event already in the feed are
dropped while the original lives (stories expire in 7 days, so the
event frees up then).

Failure policy: dedup must never block or empty ingestion. Any
Claude failure, malformed output, or empty candidate list returns
the candidates unchanged, and the fallback is logged.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Optional

from anthropic import AsyncAnthropic

log = logging.getLogger("crrnt.event_dedup")

MODEL = "claude-haiku-4-5"

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
    "You group news headlines by the underlying EVENT for CRRNT, a "
    "news app that tells each story once.\n\n"
    "Two headlines are the same event when they report the same "
    "specific occurrence, or later developments and follow-ups of "
    "that same unfolding story — even when the wording, angle, and "
    "source differ completely. Example: 'Spy allegedly recruited to "
    "target Nvidia CEO' and 'Nvidia board investigating CEO over "
    "suspected spy relationship' are ONE event (the same unfolding "
    "story), as are 'CEO admits affair, company investigating' "
    "follow-ups to it.\n\n"
    "They are DIFFERENT events when they are separate occurrences "
    "that merely share a person, company, team, or topic. Example: "
    "'Nvidia earnings beat expectations' and the spy story above "
    "are different events; a product launch and a lawsuit involving "
    "the same company are different events; two different games by "
    "the same team are different events.\n\n"
    "Reply with a single JSON object only: {\"groups\": [[i, j, "
    "...], ...]} — each inner list holds the 1-based numbers of two "
    "or more headlines that are the same event. Headlines that are "
    "not part of any group are unique events; do not list them."
)


def _parse_groups(text: str, count: int) -> list[list[int]]:
    """Parse the grouping reply into 0-based index groups. Raises
    ValueError on anything unusable; individual bad indices are
    ignored."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    data = None
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            data = json.loads(match.group(0))
    if not isinstance(data, dict) or not isinstance(data.get("groups"), list):
        raise ValueError("Dedup reply has no 'groups' list")

    groups: list[list[int]] = []
    for group in data["groups"]:
        if not isinstance(group, list):
            continue
        idxs: list[int] = []
        for item in group:
            try:
                idx = int(item)
            except (TypeError, ValueError):
                continue
            if 1 <= idx <= count and (idx - 1) not in idxs:
                idxs.append(idx - 1)
        if len(idxs) >= 2:
            groups.append(idxs)
    return groups


def apply_groups(
    candidates: list[dict[str, Any]],
    live_count: int,
    groups: list[list[int]],
) -> list[dict[str, Any]]:
    """Apply first-telling-wins to combined-index groups.

    The combined list the model saw is [live stories (indices
    0..live_count-1)] + [candidates]. A candidate is dropped when:
    - its group contains a live story (the feed already tells it), or
    - an earlier candidate in its group was kept (first in ranked
      order wins).
    Ungrouped candidates are always kept, so this can never empty
    the run."""
    dropped: set[int] = set()  # candidate positions (0-based)
    for group in groups:
        has_live = any(i < live_count for i in group)
        kept_in_group = False
        for i in group:
            if i < live_count:
                continue
            pos = i - live_count
            if has_live or kept_in_group:
                dropped.add(pos)
            else:
                kept_in_group = True
    return [c for pos, c in enumerate(candidates) if pos not in dropped]


async def dedupe_events(
    candidates: list[dict[str, Any]],
    live_titles: list[str],
) -> list[dict[str, Any]]:
    """Drop candidates that retell an event the feed already has —
    or that an earlier winner in this run already tells.

    `candidates` are the run's ranked winners (RSS article dicts);
    `live_titles` are the headlines of stories currently in the
    feed. Returns the kept candidates in their original order. Any
    failure returns `candidates` unchanged."""
    if not candidates:
        return candidates
    if len(candidates) == 1 and not live_titles:
        return candidates

    headlines = list(live_titles) + [(c.get("title") or "") for c in candidates]
    listing = "\n".join(
        f"{i + 1}. {title}" for i, title in enumerate(headlines)
    )
    try:
        client = _get_client()
        msg = await client.messages.create(
            model=MODEL,
            max_tokens=1200,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": listing}],
        )
        text = "".join(
            block.text for block in msg.content if block.type == "text"
        )
        groups = _parse_groups(text, len(headlines))
    except Exception as exc:
        log.warning(
            "Event dedup unavailable (%s) — keeping all %d winners",
            exc,
            len(candidates),
        )
        return candidates

    kept = apply_groups(candidates, len(live_titles), groups)
    if len(kept) < len(candidates):
        kept_titles = {(c.get("title") or "") for c in kept}
        for c in candidates:
            if (c.get("title") or "") not in kept_titles:
                log.info(
                    "Event dedup: dropped duplicate telling: %s",
                    (c.get("title") or "")[:110],
                )
        log.info(
            "Event dedup: kept %d of %d winners (%d live stories compared)",
            len(kept),
            len(candidates),
            len(live_titles),
        )
    return kept
