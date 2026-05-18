"""Onboarding quiz — save and retrieve user preferences."""
from __future__ import annotations

import re
from typing import Any, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator

from services import db
from services.auth_middleware import get_current_user

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])

_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")


def _clean(value: str) -> str:
    return _CONTROL_RE.sub("", value).strip()


class QuizPayload(BaseModel):
    job_type: Optional[str] = None
    housing_status: Optional[str] = None
    city: Optional[str] = None
    financial_goals: Optional[list[str]] = None
    life_stage: Optional[str] = None
    interests: Optional[list[str]] = None
    income_bracket: Optional[str] = None

    @field_validator("job_type", "housing_status", "city", "life_stage", "income_bracket", mode="before")
    @classmethod
    def sanitize_string(cls, v: Any) -> Any:
        if v is None:
            return v
        if not isinstance(v, str) or len(v) > 100:
            raise ValueError("must be a string under 100 characters")
        return _clean(v)

    @field_validator("financial_goals", "interests", mode="before")
    @classmethod
    def sanitize_list(cls, v: Any) -> Any:
        if v is None:
            return v
        if not isinstance(v, list) or len(v) > 20:
            raise ValueError("must be a list with at most 20 items")
        cleaned = []
        for item in v:
            if not isinstance(item, str) or len(item) > 100:
                raise ValueError("each item must be a string under 100 characters")
            cleaned.append(_clean(item))
        return cleaned


@router.post("/quiz")
async def save_quiz(
    body: QuizPayload,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    prefs = db.upsert_preferences(user["id"], body.model_dump(exclude_none=True))
    db.update_user(user["id"], {"onboarding_complete": True})
    return {"message": "Preferences saved", "preferences": prefs}


@router.get("/quiz")
async def get_quiz(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    prefs = db.get_preferences(user["id"])
    return {"preferences": prefs}
