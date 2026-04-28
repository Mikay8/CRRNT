"""Admin routes for ingestion controls.

Protected by a shared admin token. The expected token is read from
the ``ADMIN_TOKEN`` env var (or falls back to ``SESSION_SECRET``);
clients must send it as the ``X-Admin-Token`` header.
"""
from __future__ import annotations

import asyncio
import hmac
import logging
import os
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, status
from fastapi.responses import JSONResponse

from services import ingestion

log = logging.getLogger("marktr.admin")

router = APIRouter(tags=["admin"])


def _expected_token() -> Optional[str]:
    return os.environ.get("ADMIN_TOKEN") or os.environ.get("SESSION_SECRET")


def _require_admin(token: Optional[str]) -> None:
    expected = _expected_token()
    if not expected:
        log.error("Admin route hit but no ADMIN_TOKEN/SESSION_SECRET configured")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin endpoints are disabled (no admin token configured)",
        )
    if not token or not hmac.compare_digest(token, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-Admin-Token",
        )


@router.get("/admin/status")
async def status_endpoint(
    x_admin_token: Optional[str] = Header(default=None),
) -> dict:
    _require_admin(x_admin_token)
    return ingestion.get_status()


@router.post("/admin/refresh")
async def refresh(
    x_admin_token: Optional[str] = Header(default=None),
) -> JSONResponse:
    _require_admin(x_admin_token)
    current = ingestion.get_status()
    if current.get("state") == "running":
        return JSONResponse(status_code=409, content=current)
    asyncio.create_task(ingestion.run_ingestion())
    return JSONResponse(status_code=202, content=ingestion.get_status())
