"""RevenueCat subscription routes — webhook, identify, status."""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel

from services import db
from services.auth_middleware import get_current_user

log = logging.getLogger("crrnt.subscriptions")
router = APIRouter(prefix="/api/subscriptions", tags=["subscriptions"])


# ── RevenueCat webhook ────────────────────────────────────────────────────────

def _verify_rc_signature(body: bytes, signature: Optional[str]) -> bool:
    secret = os.environ.get("REVENUECAT_WEBHOOK_SECRET", "")
    if not secret or not signature:
        return not secret  # if no secret configured, allow all
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature.lower())


@router.post("/revenuecat/webhook")
async def revenuecat_webhook(
    request: Request,
    x_revenuecat_signature: Optional[str] = Header(default=None),
) -> dict[str, str]:
    body = await request.body()
    if not _verify_rc_signature(body, x_revenuecat_signature):
        raise HTTPException(status_code=401, detail="Invalid RC signature")

    payload = await request.json()
    event = payload.get("event", {})
    event_type = event.get("type", "")
    app_user_id = event.get("app_user_id") or event.get("original_app_user_id")

    if not app_user_id:
        log.warning("RC webhook: no app_user_id in event type=%s", event_type)
        return {"status": "ignored"}

    # Find user by revenuecat_customer_id first, then by user id
    user = None
    users = db.list_users(limit=1)  # not efficient but RC events are rare
    # Try to find by RC customer ID
    all_users = db.get_client().table("users").select("*").eq("revenuecat_customer_id", app_user_id).execute()
    if all_users.data:
        user = all_users.data[0]
    else:
        # app_user_id might be the Supabase user UUID
        user = db.get_user(app_user_id)

    if not user:
        log.warning("RC webhook: no user found for app_user_id=%s", app_user_id)
        return {"status": "user_not_found"}

    user_id = user["id"]
    event_id = event.get("id", "unknown")
    expiry = event.get("expiration_at_ms")
    expires_at = None
    if expiry:
        from datetime import datetime, timezone
        expires_at = datetime.fromtimestamp(expiry / 1000, tz=timezone.utc).isoformat()

    kwargs: dict[str, Any] = {"event_id": event_id, "event_type": event_type}

    if event_type in ("INITIAL_PURCHASE", "RENEWAL"):
        db.update_user_subscription(
            user_id,
            tier="paid",
            subscription_status="active",
            subscription_expires_at=expires_at,
            **kwargs,
        )

    elif event_type == "CANCELLATION":
        db.update_user_subscription(
            user_id,
            subscription_status="cancelled",
            subscription_expires_at=expires_at,
            **kwargs,
        )

    elif event_type == "EXPIRATION":
        db.update_user_subscription(
            user_id,
            tier="free",
            subscription_status="expired",
            **kwargs,
        )

    elif event_type == "BILLING_ISSUE":
        db.update_user_subscription(
            user_id,
            subscription_status="billing_issue",
            **kwargs,
        )

    else:
        log.info("RC webhook: unhandled event_type=%s user=%s event_id=%s", event_type, user_id, event_id)

    return {"status": "processed", "event_type": event_type}


# ── Identify ──────────────────────────────────────────────────────────────────

class IdentifyRequest(BaseModel):
    revenuecat_customer_id: str


@router.post("/revenuecat/identify")
async def identify(
    body: IdentifyRequest,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    updated = db.update_user(
        user["id"],
        {"revenuecat_customer_id": body.revenuecat_customer_id},
    )
    return {"message": "RevenueCat ID linked", "user": updated}


# ── Client-side sync ─────────────────────────────────────────────────────────
# Used when RC Preview Mode (Expo Go) means no webhook fires. The client calls
# this after RC confirms an entitlement so Supabase stays in sync.

class SyncRequest(BaseModel):
    is_pro: bool


@router.post("/sync")
async def sync_tier(
    body: SyncRequest,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    current_tier = user.get("tier", "free")
    new_tier = "paid" if body.is_pro else "free"
    if new_tier != current_tier:
        db.update_user_subscription(
            user["id"],
            tier=new_tier,
            subscription_status="active" if body.is_pro else "expired",
            event_id="client-sync",
            event_type="CLIENT_SYNC",
        )
    return {"tier": new_tier}


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/status")
async def subscription_status(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    return {
        "tier": user.get("tier", "free"),
        "subscription_status": user.get("subscription_status", "none"),
        "subscription_expires_at": user.get("subscription_expires_at"),
        "revenuecat_customer_id": user.get("revenuecat_customer_id"),
    }
