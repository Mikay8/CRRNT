"""Local auth — password hashing + JWT issuance/verification.

Replaces Supabase Auth. Tokens are signed HS256 with JWT_SECRET and carry the
user id in `sub`. Access tokens are short-lived; refresh tokens are long-lived
and only ever exchanged for a new access token via /api/auth/refresh.
"""
from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import bcrypt
from jose import JWTError, jwt

ACCESS_TOKEN_TTL = timedelta(hours=1)
REFRESH_TOKEN_TTL = timedelta(days=30)
RESET_TOKEN_TTL = timedelta(hours=1)
_ALGORITHM = "HS256"


def _secret() -> str:
    secret = os.environ.get("JWT_SECRET", "")
    if not secret:
        raise RuntimeError("JWT_SECRET must be set")
    return secret


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def _create_token(user_id: str, ttl: timedelta, token_type: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "type": token_type,
        "iat": now,
        "exp": now + ttl,
    }
    return jwt.encode(payload, _secret(), algorithm=_ALGORITHM)


def create_access_token(user_id: str) -> str:
    return _create_token(user_id, ACCESS_TOKEN_TTL, "access")


def create_refresh_token(user_id: str) -> str:
    return _create_token(user_id, REFRESH_TOKEN_TTL, "refresh")


def create_session(user_id: str) -> dict[str, Any]:
    return {
        "access_token": create_access_token(user_id),
        "refresh_token": create_refresh_token(user_id),
        "expires_in": int(ACCESS_TOKEN_TTL.total_seconds()),
    }


def decode_token(token: str, *, expected_type: str) -> Optional[str]:
    """Return the user id (sub) if the token is valid and of the expected type."""
    try:
        payload = jwt.decode(token, _secret(), algorithms=[_ALGORITHM])
    except JWTError:
        return None
    if payload.get("type") != expected_type:
        return None
    return payload.get("sub")


def generate_reset_token() -> str:
    """Opaque, high-entropy token stored (not JWT) so it can be single-use/revocable."""
    return secrets.token_urlsafe(32)
