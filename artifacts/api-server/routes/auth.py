"""Authentication routes — register, login, logout, profile."""
from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr

from services import db
from services.auth_middleware import get_current_user

log = logging.getLogger("crrnt.auth")
router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


# ── Register ──────────────────────────────────────────────────────────────────

@router.post("/register", status_code=201)
async def register(body: RegisterRequest) -> dict[str, Any]:
    client = db.get_client()
    try:
        res = client.auth.sign_up({"email": body.email, "password": body.password})
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not res.user:
        raise HTTPException(status_code=400, detail="Registration failed")

    # Ensure public.users row exists
    user = db.get_user(res.user.id)
    if not user:
        user = db.create_user(res.user.id, body.email)

    return {
        "user": user,
        "session": {
            "access_token": res.session.access_token if res.session else None,
            "refresh_token": res.session.refresh_token if res.session else None,
        },
    }


# ── Login ─────────────────────────────────────────────────────────────────────

@router.post("/login")
async def login(body: LoginRequest) -> dict[str, Any]:
    client = db.get_client()
    try:
        res = client.auth.sign_in_with_password(
            {"email": body.email, "password": body.password}
        )
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not res.session:
        raise HTTPException(status_code=401, detail="Login failed")

    user = db.get_user(res.user.id) or db.create_user(res.user.id, body.email)

    return {
        "user": user,
        "session": {
            "access_token": res.session.access_token,
            "refresh_token": res.session.refresh_token,
            "expires_in": res.session.expires_in,
        },
    }


# ── Logout ────────────────────────────────────────────────────────────────────

@router.post("/logout")
async def logout(user: dict = Depends(get_current_user)) -> dict[str, str]:
    try:
        db.get_client().auth.sign_out()
    except Exception:
        pass
    return {"message": "Logged out"}


# ── Me ────────────────────────────────────────────────────────────────────────

@router.get("/me")
async def me(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    prefs = db.get_preferences(user["id"])
    return {"user": user, "preferences": prefs}
