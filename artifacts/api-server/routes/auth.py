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

    # Use admin API to create the user with email pre-confirmed so the app
    # can sign in immediately without requiring an email verification step.
    try:
        res = client.auth.admin.create_user({
            "email": body.email,
            "password": body.password,
            "email_confirm": True,
        })
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not res.user:
        raise HTTPException(status_code=400, detail="Registration failed")

    # Ensure public.users row exists
    try:
        user = db.get_user(res.user.id)
        if not user:
            user = db.create_user(res.user.id, body.email)
    except Exception as exc:
        log.error("Failed to create/get user row after sign_up: %s", exc)
        raise HTTPException(status_code=500, detail=f"User profile creation failed: {exc}")

    # Sign in immediately to get a session token
    try:
        login_res = client.auth.sign_in_with_password(
            {"email": body.email, "password": body.password}
        )
        session = login_res.session
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Auto sign-in after registration failed: {exc}")

    return {
        "user": user,
        "requires_confirmation": False,
        "session": {
            "access_token": session.access_token,
            "refresh_token": session.refresh_token,
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


# ── Forgot password ───────────────────────────────────────────────────────────

class ForgotPasswordRequest(BaseModel):
    email: EmailStr


@router.post("/forgot-password", status_code=200)
async def forgot_password(body: ForgotPasswordRequest) -> dict[str, str]:
    redirect_to = os.environ.get("APP_RESET_PASSWORD_URL", "")
    client = db.get_client()
    try:
        opts: dict[str, Any] = {}
        if redirect_to:
            opts["redirect_to"] = redirect_to
        client.auth.reset_password_for_email(body.email, opts)
    except Exception as exc:
        log.warning("reset_password_for_email error: %s", exc)
    # Always return success to avoid email enumeration
    return {"message": "If that email is registered you will receive a reset link."}


# ── Refresh ───────────────────────────────────────────────────────────────────

class RefreshRequest(BaseModel):
    refresh_token: str


@router.post("/refresh")
async def refresh(body: RefreshRequest) -> dict[str, Any]:
    client = db.get_client()
    try:
        res = client.auth.refresh_session(body.refresh_token)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Refresh token invalid or expired")

    if not res.session:
        raise HTTPException(status_code=401, detail="Refresh failed")

    user = db.get_user(res.user.id) or db.create_user(res.user.id, res.user.email)

    return {
        "user": user,
        "session": {
            "access_token": res.session.access_token,
            "refresh_token": res.session.refresh_token,
            "expires_in": res.session.expires_in,
        },
    }


# ── Send email verification ───────────────────────────────────────────────────

@router.post("/send-verification", status_code=200)
async def send_verification(user: dict = Depends(get_current_user)) -> dict[str, str]:
    """Resend the signup confirmation email (not a magic link)."""
    redirect_to = os.environ.get("APP_VERIFY_EMAIL_URL", "")
    client = db.get_client()
    try:
        opts: dict[str, Any] = {"type": "signup", "email": user["email"]}
        if redirect_to:
            opts["options"] = {"email_redirect_to": redirect_to}
        client.auth.resend(opts)
    except Exception as exc:
        log.warning("send_verification error for %s: %s", user["email"], exc)
    return {"message": "Verification email sent"}


# ── Mark email verified ────────────────────────────────────────────────────────

@router.post("/mark-verified", status_code=200)
async def mark_verified(user: dict = Depends(get_current_user)) -> dict[str, str]:
    """Called by the app after the user clicks the verification link."""
    db.update_user(user["id"], {"email_verified": True})
    return {"message": "Email verified"}


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


# ── Delete account ────────────────────────────────────────────────────────────

@router.delete("/account", status_code=204)
async def delete_account(user: dict = Depends(get_current_user)) -> None:
    """Permanently delete the authenticated user's account and all associated data.

    The user_id is taken exclusively from the validated JWT — callers cannot
    supply a different ID to delete another user's account.
    """
    try:
        db.delete_user_account(user["id"])
    except Exception as exc:
        log.error("Failed to delete account for user %s: %s", user["id"], exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))
