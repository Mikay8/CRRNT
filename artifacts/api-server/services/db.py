"""Supabase client — service-role access for all backend operations.

Every table has RLS enabled. The service-role key (SUPABASE_SERVICE_KEY) intentionally
bypasses RLS so the backend can perform operations that no single authenticated user is
allowed to do directly:
  - webhook: look up a user row by revenuecat_customer_id (cross-user read)
  - ingestion: insert/update stories (no auth.uid() exists in a background job)
  - admin portal: list all users and stories

Never expose the service-role key or any response from it to the frontend.
All public-facing data is filtered and tier-gated at the route layer before
it is returned to the client.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

from supabase import create_client, Client

log = logging.getLogger("crrnt.db")

_client: Optional[Client] = None


def get_client() -> Client:
    global _client
    if _client is None:
        url = os.environ.get("SUPABASE_URL", "")
        key = os.environ.get("SUPABASE_SERVICE_KEY", "")
        if not url or not key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
        _client = create_client(url, key)
        log.info("Supabase client initialised")
    return _client


# ── Stories ───────────────────────────────────────────────────────────────────

def insert_story(story: dict[str, Any]) -> dict[str, Any]:
    """Insert a story row and return the inserted record (with id)."""
    result = get_client().table("stories").insert(story).execute()
    return result.data[0]


def get_story(story_id: str) -> Optional[dict[str, Any]]:
    result = get_client().table("stories").select("*").eq("id", story_id).execute()
    return result.data[0] if result.data else None


def get_story_by_external_id(external_id: str) -> Optional[dict[str, Any]]:
    result = (
        get_client().table("stories")
        .select("*")
        .eq("external_id", external_id)
        .execute()
    )
    return result.data[0] if result.data else None


def update_story(story_id: str, fields: dict[str, Any]) -> Optional[dict[str, Any]]:
    result = (
        get_client().table("stories")
        .update(fields)
        .eq("id", story_id)
        .execute()
    )
    return result.data[0] if result.data else None


def delete_story(story_id: str) -> None:
    client = get_client()
    for table in ("story_personalizations", "user_story_audio", "saved_stories"):
        try:
            client.table(table).delete().eq("story_id", story_id).execute()
        except Exception as exc:
            log.warning("delete_story: skipping %s for %s — %s", table, story_id, exc)
    client.table("stories").delete().eq("id", story_id).execute()


def get_stories(
    *,
    category: Optional[str] = None,
    tier: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    q = get_client().table("stories").select("*").order("published_at", desc=True)
    if category:
        q = q.eq("category", category)
    if tier:
        q = q.eq("tier", tier)
    q = q.limit(limit).offset(offset)
    return q.execute().data or []


def count_stories(
    *, category: Optional[str] = None, tier: Optional[str] = None
) -> int:
    q = get_client().table("stories").select("id", count="exact")
    if category:
        q = q.eq("category", category)
    if tier:
        q = q.eq("tier", tier)
    return q.execute().count or 0


def get_stories_for_feed(published_since_days: int = 7) -> list[dict[str, Any]]:
    """Return all non-expired stories from the past N days for feed scoring."""
    from datetime import datetime, timedelta, timezone

    cutoff = (datetime.now(timezone.utc) - timedelta(days=published_since_days)).isoformat()
    now_str = datetime.now(timezone.utc).isoformat()
    result = (
        get_client().table("stories")
        .select("*")
        .gte("published_at", cutoff)
        .or_(f"expires_at.is.null,expires_at.gt.{now_str}")
        .order("published_at", desc=True)
        .limit(200)
        .execute()
    )
    return result.data or []


# ── Saved stories ─────────────────────────────────────────────────────────────

def save_story(user_id: str, story_id: str) -> dict[str, Any]:
    result = (
        get_client().table("saved_stories")
        .upsert({"user_id": user_id, "story_id": story_id})
        .execute()
    )
    return result.data[0] if result.data else {}


def unsave_story(user_id: str, story_id: str) -> None:
    (
        get_client().table("saved_stories")
        .delete()
        .eq("user_id", user_id)
        .eq("story_id", story_id)
        .execute()
    )


def get_saved_stories(user_id: str) -> list[dict[str, Any]]:
    result = (
        get_client().table("saved_stories")
        .select("story_id, saved_at, stories(*)")
        .eq("user_id", user_id)
        .order("saved_at", desc=True)
        .execute()
    )
    rows = result.data or []
    return [{"saved_at": r["saved_at"], **r["stories"]} for r in rows if r.get("stories")]


def saved_story_count(story_id: str) -> int:
    result = (
        get_client().table("saved_stories")
        .select("id", count="exact")
        .eq("story_id", story_id)
        .execute()
    )
    return result.count or 0


def count_saved_stories(user_id: str) -> int:
    result = (
        get_client().table("saved_stories")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .execute()
    )
    return result.count or 0


def is_story_saved(user_id: str, story_id: str) -> bool:
    result = (
        get_client().table("saved_stories")
        .select("id")
        .eq("user_id", user_id)
        .eq("story_id", story_id)
        .execute()
    )
    return bool(result.data)


# ── Breaking news ──────────────────────────────────────────────────────────────

def get_active_breaking_news() -> Optional[dict[str, Any]]:
    from datetime import datetime, timezone

    result = (
        get_client().table("breaking_news")
        .select("*")
        .gt("expires_at", datetime.now(timezone.utc).isoformat())
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def insert_breaking_news(headline: str, link: str, ttl_hours: int = 6) -> dict[str, Any]:
    from datetime import datetime, timedelta, timezone

    expires_at = (datetime.now(timezone.utc) + timedelta(hours=ttl_hours)).isoformat()
    result = (
        get_client().table("breaking_news")
        .insert({"headline": headline, "link": link, "expires_at": expires_at})
        .execute()
    )
    return result.data[0]


def dismiss_breaking_news(record_id: str) -> None:
    get_client().table("breaking_news").delete().eq("id", record_id).execute()


def get_recent_breaking_news(limit: int = 10) -> list[dict[str, Any]]:
    result = (
        get_client().table("breaking_news")
        .select("*")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return result.data or []


# ── Users ─────────────────────────────────────────────────────────────────────

def get_user(user_id: str) -> Optional[dict[str, Any]]:
    result = get_client().table("users").select("*").eq("id", user_id).execute()
    return result.data[0] if result.data else None


def get_user_by_email(email: str) -> Optional[dict[str, Any]]:
    result = get_client().table("users").select("*").eq("email", email).execute()
    return result.data[0] if result.data else None


def create_user(user_id: str, email: str) -> dict[str, Any]:
    """Create a users row after Supabase Auth creates the auth.users entry.

    Uses upsert so this is idempotent if a DB trigger already created the row.
    """
    result = (
        get_client().table("users")
        .upsert({"id": user_id, "email": email, "email_verified": True}, on_conflict="id")
        .execute()
    )
    if result.data:
        return result.data[0]
    # Upsert returned no data (no-op on conflict) — fetch the existing row
    existing = get_user(user_id)
    if existing:
        return existing
    raise RuntimeError(f"Failed to create or retrieve user row for {user_id}")


_TIER_FIELDS = frozenset({"tier", "subscription_status", "subscription_expires_at"})


def update_user(user_id: str, fields: dict[str, Any]) -> Optional[dict[str, Any]]:
    forbidden = _TIER_FIELDS & fields.keys()
    if forbidden:
        log.error(
            "update_user called with forbidden tier fields %s for user %s — use update_user_subscription instead",
            forbidden, user_id,
        )
        fields = {k: v for k, v in fields.items() if k not in _TIER_FIELDS}
    if not fields:
        return get_user(user_id)
    result = (
        get_client().table("users")
        .update(fields)
        .eq("id", user_id)
        .execute()
    )
    return result.data[0] if result.data else None


def update_user_subscription(
    user_id: str,
    *,
    tier: Optional[str] = None,
    subscription_status: Optional[str] = None,
    subscription_expires_at: Optional[str] = None,
    event_id: str = "unknown",
    event_type: str = "unknown",
) -> Optional[dict[str, Any]]:
    """Only path allowed to write tier/subscription_status. Called exclusively from the RC webhook."""
    current = get_user(user_id)
    old_tier = current.get("tier") if current else "unknown"

    fields: dict[str, Any] = {}
    if tier is not None:
        fields["tier"] = tier
    if subscription_status is not None:
        fields["subscription_status"] = subscription_status
    if subscription_expires_at is not None:
        fields["subscription_expires_at"] = subscription_expires_at

    if not fields:
        return current

    result = (
        get_client().table("users")
        .update(fields)
        .eq("id", user_id)
        .execute()
    )
    log.info(
        "subscription_change user=%s old_tier=%s new_tier=%s status=%s event_type=%s event_id=%s",
        user_id, old_tier, tier or old_tier, subscription_status or "unchanged",
        event_type, event_id,
    )
    return result.data[0] if result.data else None


def list_users(tier: Optional[str] = None, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
    q = get_client().table("users").select("*").order("created_at", desc=True)
    if tier:
        q = q.eq("tier", tier)
    return q.limit(limit).offset(offset).execute().data or []


def count_users(tier: Optional[str] = None) -> int:
    q = get_client().table("users").select("id", count="exact")
    if tier:
        q = q.eq("tier", tier)
    return q.execute().count or 0


def delete_user_account(user_id: str) -> None:
    """Hard-delete all user data, then remove from auth.users.

    Only deletes the row belonging to user_id — the caller must have already
    verified that user_id matches the authenticated requester's JWT sub claim.
    """
    client = get_client()
    for table in ("saved_stories", "user_preferences", "story_personalizations", "user_story_audio"):
        try:
            client.table(table).delete().eq("user_id", user_id).execute()
        except Exception as exc:
            log.warning("delete_user_account: skipping %s for %s — %s", table, user_id, exc)
    client.table("users").delete().eq("id", user_id).execute()
    log.info("delete_user_account: deleted users row for %s, removing auth identity", user_id)
    client.auth.admin.delete_user(user_id)
    log.info("delete_user_account: completed for %s", user_id)


# ── User preferences ──────────────────────────────────────────────────────────

def get_preferences(user_id: str) -> Optional[dict[str, Any]]:
    result = (
        get_client().table("user_preferences")
        .select("*")
        .eq("user_id", user_id)
        .execute()
    )
    return result.data[0] if result.data else None


def upsert_preferences(user_id: str, prefs: dict[str, Any]) -> dict[str, Any]:
    from datetime import datetime, timezone

    payload = {
        **prefs,
        "user_id": user_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    existing = get_preferences(user_id)
    if existing:
        result = (
            get_client().table("user_preferences")
            .update(payload)
            .eq("user_id", user_id)
            .execute()
        )
    else:
        result = (
            get_client().table("user_preferences")
            .insert(payload)
            .execute()
        )
    return result.data[0] if result.data else payload


# ── App settings (persistent config) ─────────────────────────────────────────

def get_app_setting(key: str) -> Optional[Any]:
    try:
        result = get_client().table("app_settings").select("value").eq("key", key).execute()
        return result.data[0]["value"] if result.data else None
    except Exception as exc:
        log.warning("get_app_setting(%s) failed: %s", key, exc)
        return None


def set_app_setting(key: str, value: Any) -> None:
    from datetime import datetime, timezone
    try:
        get_client().table("app_settings").upsert({
            "key": key,
            "value": value,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
    except Exception as exc:
        log.warning("set_app_setting(%s) failed: %s", key, exc)


# ── Ingestion logs ─────────────────────────────────────────────────────────────

def insert_ingestion_log(log_entry: dict[str, Any]) -> dict[str, Any]:
    result = get_client().table("ingestion_logs").insert(log_entry).execute()
    return result.data[0]


def get_ingestion_logs(limit: int = 10) -> list[dict[str, Any]]:
    result = (
        get_client().table("ingestion_logs")
        .select("*")
        .order("run_at", desc=True)
        .limit(limit)
        .execute()
    )
    return result.data or []


# ── Story expiry cleanup ──────────────────────────────────────────────────────

def get_expired_stories() -> list[dict[str, Any]]:
    from datetime import datetime, timezone

    result = (
        get_client().table("stories")
        .select("id")
        .lt("expires_at", datetime.now(timezone.utc).isoformat())
        .execute()
    )
    return result.data or []


def extend_story_expiry(story_id: str, days: int = 30) -> None:
    from datetime import datetime, timedelta, timezone

    new_expiry = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
    get_client().table("stories").update({"expires_at": new_expiry}).eq("id", story_id).execute()


def get_active_subscribers_count() -> int:
    result = (
        get_client().table("users")
        .select("id", count="exact")
        .eq("tier", "paid")
        .eq("subscription_status", "active")
        .execute()
    )
    return result.count or 0


# ── Story personalizations ─────────────────────────────────────────────────────

def get_personalization(user_id: str, story_id: str) -> Optional[dict[str, Any]]:
    try:
        result = (
            get_client().table("story_personalizations")
            .select("personalized_text")
            .eq("user_id", user_id)
            .eq("story_id", story_id)
            .execute()
        )
        return result.data[0] if result.data else None
    except Exception:
        return None


def store_personalization(user_id: str, story_id: str, text: str) -> None:
    get_client().table("story_personalizations").upsert({
        "user_id": user_id,
        "story_id": story_id,
        "personalized_text": text,
    }).execute()


# ── Per-user full story audio ─────────────────────────────────────────────────

def get_user_audio(user_id: str, story_id: str) -> Optional[bytes]:
    import base64
    try:
        result = (
            get_client().table("user_story_audio")
            .select("mp3_data")
            .eq("user_id", user_id)
            .eq("story_id", story_id)
            .execute()
        )
    except Exception:
        return None
    if not result.data or not result.data[0].get("mp3_data"):
        return None
    raw = result.data[0]["mp3_data"]
    if isinstance(raw, str):
        if raw.startswith("\\x"):
            return bytes.fromhex(raw[2:])
        return base64.b64decode(raw)
    return bytes(raw)


def store_user_audio(user_id: str, story_id: str, mp3_bytes: bytes) -> None:
    import base64
    get_client().table("user_story_audio").upsert({
        "user_id": user_id,
        "story_id": story_id,
        "mp3_data": base64.b64encode(mp3_bytes).decode(),
    }).execute()
