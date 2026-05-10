"""Onboarding quiz — save and retrieve user preferences."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from services import db
from services.auth_middleware import get_current_user

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])


class QuizPayload(BaseModel):
    job_type: Optional[str] = None
    housing_status: Optional[str] = None
    city: Optional[str] = None
    financial_goals: Optional[list[str]] = None
    life_stage: Optional[str] = None
    interests: Optional[list[str]] = None
    income_bracket: Optional[str] = None


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
