from __future__ import annotations

import logging

from fastapi import APIRouter

from services import app_settings

log = logging.getLogger("crrnt.health")

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/config", tags=["config"])
async def app_config() -> dict[str, int]:
    """Public client config the app enforces locally.

    save_limit is the admin's Feed & Save Limits value (app_settings
    feed_limits.daily). The authed save endpoint enforces it
    server-side; guests save on-device, so the app fetches this and
    enforces the same number in its save path — one variable limit
    for every save, per the owner's direction (2026-11-07).
    """
    try:
        limits = await app_settings.get_feed_limits()
        save_limit = int(limits.get("daily", 15))
    except Exception as exc:
        log.warning("app_config: feed_limits read failed: %s", exc)
        save_limit = 15
    return {"save_limit": max(1, save_limit)}
