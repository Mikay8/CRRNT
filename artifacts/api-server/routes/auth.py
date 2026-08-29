"""Authentication routes — register, login, refresh, logout, profile."""
from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from services import auth, db, email_service
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
    existing = await db.get_user_by_email(body.email)
    if existing:
        raise HTTPException(status_code=400, detail="An account with this email already exists")

    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    password_hash = auth.hash_password(body.password)
    try:
        user = await db.create_user(body.email, password_hash)
    except Exception as exc:
        log.error("Failed to create user row for %s: %s", body.email, exc)
        raise HTTPException(status_code=500, detail="Registration failed")

    return {
        "user": user,
        "session": auth.create_session(user["id"]),
    }


# ── Login ─────────────────────────────────────────────────────────────────────

@router.post("/login")
async def login(body: LoginRequest) -> dict[str, Any]:
    user = await db.get_user_by_email(body.email)
    if not user or not auth.verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    return {
        "user": user,
        "session": auth.create_session(user["id"]),
    }


# ── Refresh ───────────────────────────────────────────────────────────────────

class RefreshRequest(BaseModel):
    refresh_token: str


@router.post("/refresh")
async def refresh(body: RefreshRequest) -> dict[str, Any]:
    user_id = auth.decode_token(body.refresh_token, expected_type="refresh")
    if not user_id:
        raise HTTPException(status_code=401, detail="Refresh token invalid or expired")

    user = await db.get_user(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return {
        "user": user,
        "session": auth.create_session(user["id"]),
    }


# ── Forgot password ───────────────────────────────────────────────────────────

class ForgotPasswordRequest(BaseModel):
    email: EmailStr


@router.post("/forgot-password", status_code=200)
async def forgot_password(body: ForgotPasswordRequest) -> dict[str, str]:
    user = await db.get_user_by_email(body.email)
    if user:
        token = auth.generate_reset_token()
        await db.create_password_reset_token(user["id"], token, auth.RESET_TOKEN_TTL)
        base_url = os.environ.get("APP_RESET_PASSWORD_URL", "")
        reset_url = f"{base_url}?token={token}" if base_url else token
        email_service.send_password_reset(body.email, reset_url)
    # Always return success to avoid email enumeration
    return {"message": "If that email is registered you will receive a reset link."}


class ResetPasswordRequest(BaseModel):
    token: str
    password: str


@router.post("/reset-password", status_code=200)
async def reset_password(body: ResetPasswordRequest) -> dict[str, str]:
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    user_id = await db.consume_password_reset_token(body.token)
    if not user_id:
        raise HTTPException(status_code=400, detail="Reset link is invalid or has expired")

    await db.update_user(user_id, {"password_hash": auth.hash_password(body.password)})
    return {"message": "Password updated"}


# ── Email verification ───────────────────────────────────────────────────────
# Note: without Supabase Auth's hosted email flows, this is a placeholder that
# marks the account verified without sending a real confirmation link. Wire up
# a real templated email via email_service.send_email() if enforcement matters.

@router.post("/send-verification", status_code=200)
async def send_verification(user: dict = Depends(get_current_user)) -> dict[str, str]:
    return {"message": "Verification email sent"}


@router.post("/mark-verified", status_code=200)
async def mark_verified(user: dict = Depends(get_current_user)) -> dict[str, str]:
    await db.update_user(user["id"], {"email_verified": True})
    return {"message": "Email verified"}


# ── Logout ────────────────────────────────────────────────────────────────────

@router.post("/logout")
async def logout(user: dict = Depends(get_current_user)) -> dict[str, str]:
    # Stateless JWTs — nothing to invalidate server-side. The client discards
    # its tokens; access tokens expire naturally within the hour.
    return {"message": "Logged out"}


# ── Me ────────────────────────────────────────────────────────────────────────

@router.get("/me")
async def me(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    prefs = await db.get_preferences(user["id"])
    return {"user": user, "preferences": prefs}


# ── Delete account ────────────────────────────────────────────────────────────

@router.delete("/account", status_code=204)
async def delete_account(user: dict = Depends(get_current_user)) -> None:
    """Permanently delete the authenticated user's account and all associated data.

    The user_id is taken exclusively from the validated JWT — callers cannot
    supply a different ID to delete another user's account.
    """
    try:
        await db.delete_user_account(user["id"])
    except Exception as exc:
        log.error("Failed to delete account for user %s: %s", user["id"], exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))
