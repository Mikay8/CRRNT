"""Story personalization — score and rank stories against user preferences."""
from __future__ import annotations

from typing import Any, Optional

from services import app_settings


def score_story(story: dict[str, Any], prefs: dict[str, Any]) -> int:
    """Return a relevance score for a story given user preferences.

    Scoring:
      +2  story category in user interests
      +2  wallet_impact mentions job_type
      +1  story text mentions user city
      +1  story text mentions financial_goals keywords
    """
    score = 0
    category = (story.get("category") or "").lower()
    title = (story.get("title") or "").lower()
    summary = (story.get("summary") or "").lower()
    life = (story.get("life_impact") or "").lower()
    wallet = (story.get("wallet_impact") or "").lower()
    haystack = f"{title} {summary} {life} {wallet}"

    interests: list[str] = prefs.get("interests") or []
    if any(i.lower() == category for i in interests):
        score += 2

    job_type: str = (prefs.get("job_type") or "").lower()
    if job_type and job_type in wallet:
        score += 2

    city: str = (prefs.get("city") or "").lower()
    if city and city in haystack:
        score += 1

    financial_goals: list[str] = prefs.get("financial_goals") or []
    for goal in financial_goals:
        if goal.lower() in haystack:
            score += 1
            break

    return score


def personalize_feed(
    stories: list[dict[str, Any]],
    prefs: Optional[dict[str, Any]],
    tier: str,
    category: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Score and rank stories for a user.

    When browsing "All" (no category filter), all available stories are returned.
    When a specific category is selected, results are capped (free → 5, paid → 15).
    """
    if prefs is None:
        prefs = {}

    if tier == "paid":
        pool = stories
    else:
        pool = [s for s in stories if s.get("tier") == "free"]

    scored = sorted(pool, key=lambda s: score_story(s, prefs), reverse=True)

    if category is None:
        return scored

    limits = app_settings.get_feed_limits()
    limit = limits["paid"] if tier == "paid" else limits["free"]

    if tier != "paid":
        # Guarantee at least one story per category before applying the limit
        seen_cats: set[str] = set()
        guaranteed = []
        fill = []
        for s in scored:
            cat = s.get("category", "")
            if cat not in seen_cats:
                seen_cats.add(cat)
                guaranteed.append(s)
            else:
                fill.append(s)
        return (guaranteed + fill)[:limit]

    return scored[:limit]
