"""Human-readable story slugs for public URLs (owner's ask,
2026-11-07: readable ids, kept short).

A slug is derived from the story's display title: lowercase,
hyphenated, at most MAX_SLUG_LEN characters, cut on a word boundary
where one is available. Uniqueness is the caller's job (db layer
appends -2, -3, ... on collision; see services.db.insert_story and
scripts/backfill_slugs.py, which share suffixed()).
"""
from __future__ import annotations

import re

MAX_SLUG_LEN = 40

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_HYPHENS = re.compile(r"-{2,}")


def slugify(text: str | None) -> str:
    """Title -> slug base. May return "" for a title with no usable
    characters; callers substitute a fallback base."""
    s = (text or "").lower().replace("'", "").replace("’", "")
    s = _NON_ALNUM.sub("-", s)
    s = _HYPHENS.sub("-", s).strip("-")
    if len(s) > MAX_SLUG_LEN:
        cut = s[:MAX_SLUG_LEN]
        # Prefer ending on a word boundary when one leaves a
        # reasonably long slug (>= 15 chars); otherwise hard-cut.
        if "-" in cut:
            trimmed = cut.rsplit("-", 1)[0]
            if len(trimmed) >= 15:
                cut = trimmed
        s = cut.strip("-")
    return s


def suffixed(base: str, n: int) -> str:
    """base + -n, trimmed so the result stays within the cap."""
    suffix = f"-{n}"
    return base[: MAX_SLUG_LEN - len(suffix)].rstrip("-") + suffix
