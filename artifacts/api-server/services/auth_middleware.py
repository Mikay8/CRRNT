"""JWT authentication middleware for FastAPI routes.

Validates Supabase-issued JWTs by calling supabase.auth.get_user(token).
Returns the public.users row (not the auth.users row) so routes get tier info.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from services import db

log = logging.getLogger("crrnt.auth")

_bearer = HTTPBearer(auto_error=False)


def _validate_token(token: str) -> Optional[dict[str, Any]]:
    """Call Supabase auth server to validate JWT. Returns auth user or None."""
    try:
        client = db.get_client()
        response = client.auth.get_user(token)
        if response and response.user:
            return {"id": response.user.id, "email": response.user.email}
        return None
    except Exception as exc:
        log.debug("Token validation failed: %s", exc)
        return None


def _extract_token(request: Request) -> Optional[str]:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


async def get_current_user(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> dict[str, Any]:
    """Dependency: validate JWT and return the public.users row. Raises 401 on failure."""
    token = creds.credentials if creds else _extract_token(request)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    auth_user = _validate_token(token)
    if not auth_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.get_user(auth_user["id"])
    if not user:
        # First time after sign-up: create the public.users row
        user = db.create_user(auth_user["id"], auth_user["email"])

    return user


async def get_current_user_optional(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> Optional[dict[str, Any]]:
    """Dependency: like get_current_user but returns None instead of 401."""
    try:
        return await get_current_user(request, creds)
    except HTTPException:
        return None


def require_paid(user: dict[str, Any]) -> None:
    """Raise 403 if user is not on the paid tier."""
    if user.get("tier") != "paid":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This content requires a CRRNT Pro subscription",
        )
