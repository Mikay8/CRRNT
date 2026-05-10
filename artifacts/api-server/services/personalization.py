"""Story personalization — score and rank stories against user preferences."""
from __future__ import annotations

from typing import Any, Optional


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
) -> list[dict[str, Any]]:
    """Score and filter stories for a user.

    Free  → top 5 free-tier stories (≥1 per category where available)
    Paid  → top 15 stories (free + paid)
    """
    if prefs is None:
        prefs = {}

    free_stories = [s for s in stories if s.get("tier") == "free"]
    paid_stories = [s for s in stories if s.get("tier") == "paid"]

    if tier == "paid":
        pool = stories
    else:
        pool = free_stories

    scored = sorted(pool, key=lambda s: score_story(s, prefs), reverse=True)

    limit = 15 if tier == "paid" else 5

    if tier != "paid":
        # Guarantee at least one story per category
        categories: list[str] = []
        seen_cats: set[str] = set()
        remainder: list[dict[str, Any]] = []
        for s in scored:
            cat = s.get("category", "")
            if cat not in seen_cats:
                seen_cats.add(cat)
                categories.append(s["id"] if "id" in s else "")
                remainder.insert(0, s)
            else:
                remainder.append(s)
        # Re-sort: put guaranteed-category stories first then fill to limit
        guaranteed = [s for s in scored if s.get("id", "") in set(categories)]
        fill = [s for s in scored if s.get("id", "") not in set(categories)]
        combined = guaranteed + fill
        return combined[:limit]

    return scored[:limit]
