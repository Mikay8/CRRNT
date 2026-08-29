"""JWT authentication middleware for FastAPI routes.

Validates locally-issued access tokens (see services/auth.py) and returns
the users row for the token's subject.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from services import auth, db

log = logging.getLogger("crrnt.auth")

_bearer = HTTPBearer(auto_error=False)


def _extract_token(request: Request) -> Optional[str]:
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:].strip()
    # Fallback for native media players that can't set headers (e.g. expo-audio streaming)
    return request.query_params.get("token") or None


async def get_current_user(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> dict[str, Any]:
    """Dependency: validate JWT and return the users row. Raises 401 on failure."""
    token = creds.credentials if creds else _extract_token(request)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = auth.decode_token(token, expected_type="access")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = await db.get_user(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

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
