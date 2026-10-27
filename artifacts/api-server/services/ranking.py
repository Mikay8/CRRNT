"""Pre-enrichment importance ranking for news stories.

One batched Claude call per category, never one call per story: the
ranking system prompt is paid once per category instead of once per
candidate, which is what makes ranking a wide candidate pool cheap.

Pipeline position (see services/ingestion.py):
  fetch a wide pool -> freshness / title / already-stored filters
  -> rank each category's candidates -> keep only the configured
  top N per category -> enrich only the winners.

What "important" means here is CRRNT-specific, not generic news
importance: scale of impact, direct wallet / life impact, cultural
heat for a young-adult audience, novelty, and corroboration (the
same event carried by multiple feeds). Ranking is per category, so
one category can never crowd out another.

Failure policy: ranking must never block ingestion. Any Claude
failure, malformed output, or unknown candidate index falls back to
the input order (newest first, as fetched) for that category, and
the fallback is logged.
"""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Optional

from anthropic import AsyncAnthropic

log = logging.getLogger("crrnt.ranking")

MODEL = "claude-haiku-4-5"
MAX_PER_SOURCE = 3

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
    "You rank news stories for CRRNT, an app that makes the news feel "
    "personal for young adults. Rank by importance to that audience, "
    "not by generic news importance.\n\n"
    "Score each story 0-100 on:\n"
    "- Scale of impact: how many people does this touch?\n"
    "- Wallet / life impact: rent, jobs, groceries, bills, career, health.\n"
    "- Cultural heat: is this what people will actually talk about today?\n"
    "- Novelty: a new development scores higher than a follow-up or "
    "evergreen item.\n"
    "- Corroboration: a story carried by multiple feeds (shown as "
    "'seen in N feeds') is more likely to be a major event.\n\n"
    "Do not favour sensational celebrity drama over a story with real "
    "wallet or life impact, and do not rank a death or tragedy by its "
    "money angle.\n\n"
    "Also group stories that are the same event told under different "
    "headlines (same people, company, or event, even if the wording "
    "differs) into duplicate_groups. Each group is a list of story "
    "numbers; a story may appear in at most one group.\n\n"
    "ALWAYS reply with a single JSON object - no prose, no markdown "
    "fences - with keys: ranked (a list of objects with keys index "
    "and score, in most-important-first order, covering every story "
    "number you were given), duplicate_groups (a list of lists of "
    "story numbers)."
)


def _age_hours(candidate: dict[str, Any]) -> Optional[float]:
    raw = candidate.get("publishedDate") or candidate.get("published_at")
    if not raw:
        return None
    try:
        if isinstance(raw, datetime):
            pub = raw
        else:
            pub = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if pub.tzinfo is None:
            pub = pub.replace(tzinfo=timezone.utc)
        return round((datetime.now(timezone.utc) - pub).total_seconds() / 3600, 1)
    except (ValueError, TypeError):
        return None


def _candidate_line(index: int, candidate: dict[str, Any]) -> str:
    age = _age_hours(candidate)
    age_txt = f"{age}h ago" if age is not None else "age unknown"
    corroboration = candidate.get("corroboration") or 1
    title = (candidate.get("title") or "").strip()
    dek = (candidate.get("description") or "").strip()
    source = candidate.get("source") or "unknown source"
    return (
        f"{index}. [{source}] ({age_txt}, seen in {corroboration} feed(s))\n"
        f"   {title}\n"
        f"   {dek}"
    )


def _parse_ranking(text: str, count: int) -> tuple[list[tuple[int, float]], list[list[int]]]:
    """Parse a ranking reply. Raises ValueError on anything unusable."""
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
    if not isinstance(data, dict) or not isinstance(data.get("ranked"), list):
        raise ValueError("Ranking reply has no 'ranked' list")

    ranked: list[tuple[int, float]] = []
    seen: set[int] = set()
    for item in data["ranked"]:
        if not isinstance(item, dict):
            continue
        try:
            idx = int(item["index"])
            score = float(item.get("score", 50))
        except (KeyError, TypeError, ValueError):
            continue
        if 1 <= idx <= count and idx not in seen:
            seen.add(idx)
            ranked.append((idx, max(0.0, min(100.0, score))))
    if not ranked:
        raise ValueError("Ranking reply ranked no valid candidates")

    groups: list[list[int]] = []
    for group in data.get("duplicate_groups") or []:
        if not isinstance(group, list):
            continue
        clean = sorted({int(i) for i in group if isinstance(i, int) or (isinstance(i, str) and i.isdigit())})
        clean = [i for i in clean if 1 <= i <= count]
        if len(clean) >= 2:
            groups.append(clean)
    return ranked, groups


def _select(
    ranked: list[tuple[int, float]],
    candidates: list[dict[str, Any]],
    top_n: int,
    duplicate_groups: Optional[list[list[int]]] = None,
    max_per_source: int = MAX_PER_SOURCE,
) -> list[dict[str, Any]]:
    """Turn a ranked index list into selected candidates.

    Guards, applied in ranked order:
    - at most one story per duplicate group (the highest-ranked wins);
    - at most `max_per_source` stories from any one source.
    Remaining slots are filled from the unselected candidates in
    input (newest-first) order, first respecting the guards, then
    ignoring the source cap so top_n is reached when possible.
    """
    # 1-based index -> group id for duplicate members.
    group_of: dict[int, int] = {}
    for gid, group in enumerate(duplicate_groups or []):
        for idx in group:
            group_of.setdefault(idx, gid)

    selected: list[dict[str, Any]] = []
    selected_idx: set[int] = set()
    used_groups: set[int] = set()
    source_counts: dict[str, int] = {}

    def _try_add(idx: int, score: Optional[float], respect_source_cap: bool) -> bool:
        if idx in selected_idx:
            return False
        gid = group_of.get(idx)
        if gid is not None and gid in used_groups:
            return False
        source = candidates[idx - 1].get("source") or ""
        if respect_source_cap and source_counts.get(source, 0) >= max_per_source:
            return False
        cand = dict(candidates[idx - 1])
        if score is not None:
            cand["importance_score"] = score
        selected.append(cand)
        selected_idx.add(idx)
        if gid is not None:
            used_groups.add(gid)
        source_counts[source] = source_counts.get(source, 0) + 1
        return True

    for idx, score in ranked:
        if len(selected) >= top_n:
            break
        _try_add(idx, score, respect_source_cap=True)
    # Fill from unranked / skipped candidates, newest first.
    for pass_respect_cap in (True, False):
        if len(selected) >= top_n:
            break
        for idx in range(1, len(candidates) + 1):
            if len(selected) >= top_n:
                break
            if idx not in selected_idx:
                _try_add(idx, None, respect_source_cap=pass_respect_cap)
    return selected


async def rank_category(
    candidates: list[dict[str, Any]],
    category: str,
    top_n: int,
) -> list[dict[str, Any]]:
    """Rank one category's candidates and keep the top `top_n`.

    Returns candidates in ranked order (falling back to input order
    on any failure). Selected candidates carry `importance_score`
    when the ranking call succeeded.
    """
    if top_n <= 0:
        return []
    if len(candidates) <= top_n:
        return list(candidates)

    lines = [_candidate_line(i + 1, c) for i, c in enumerate(candidates)]
    user_prompt = (
        f"Category: {category}\n"
        f"Rank these {len(candidates)} stories, most important first.\n\n"
        + "\n".join(lines)
        + "\n\nReply with the JSON object only."
    )
    try:
        client = _get_client()
        msg = await client.messages.create(
            model=MODEL,
            max_tokens=800,
            temperature=0,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        ranked, groups = _parse_ranking(text, len(candidates))
    except Exception as exc:  # noqa: BLE001 - ranking must never block ingestion
        log.warning("Ranking failed for category '%s', using newest-first: %s", category, exc)
        return list(candidates[:top_n])

    selected = _select(ranked, candidates, top_n, duplicate_groups=groups)
    log.info(
        "Ranking: category '%s' kept %d of %d candidates (top score %.0f)",
        category,
        len(selected),
        len(candidates),
        ranked[0][1] if ranked else 0,
    )
    return selected


async def rank_categories(
    candidates_by_category: dict[str, list[dict[str, Any]]],
    counts: dict[str, int],
) -> dict[str, list[dict[str, Any]]]:
    """Rank every category in turn. Sequential, not concurrent: one
    category's ranking failure must not affect the others, and eight
    small calls do not justify the extra rate-limit surface."""
    out: dict[str, list[dict[str, Any]]] = {}
    for category, candidates in candidates_by_category.items():
        out[category] = await rank_category(candidates, category, counts.get(category, len(candidates)))
    return out


__all__ = ["MODEL", "rank_category", "rank_categories"]
