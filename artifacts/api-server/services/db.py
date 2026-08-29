"""Railway Postgres connection pool + typed helpers for all tables.

Replaces the old Supabase REST client. The backend is the only DB client —
there is no RLS layer — so every route is responsible for only ever passing
a user_id/story_id that the caller is actually allowed to touch (the JWT
'sub' claim, never a client-supplied id, for anything user-scoped).
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import asyncpg

log = logging.getLogger("crrnt.db")

_pool: Optional[asyncpg.Pool] = None


async def init_pool() -> None:
    global _pool
    if _pool is not None:
        return
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn:
        raise RuntimeError("DATABASE_URL must be set")
    _pool = await asyncpg.create_pool(dsn, min_size=1, max_size=10)
    log.info("Postgres pool initialised")


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("DB pool not initialised — call init_pool() at startup")
    return _pool


def _serialize(value: Any) -> Any:
    """asyncpg returns native datetime objects; the API/templates expect ISO
    strings, matching the shape the old Supabase REST client returned."""
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _row(r: Optional[asyncpg.Record]) -> Optional[dict[str, Any]]:
    if r is None:
        return None
    return {k: _serialize(v) for k, v in dict(r).items()}


def _rows(rs: list[asyncpg.Record]) -> list[dict[str, Any]]:
    return [_row(r) for r in rs]


# ── Stories ───────────────────────────────────────────────────────────────────

async def insert_story(story: dict[str, Any]) -> dict[str, Any]:
    cols = list(story.keys())
    placeholders = ", ".join(f"${i+1}" for i in range(len(cols)))
    sql = (
        f"INSERT INTO stories ({', '.join(cols)}) VALUES ({placeholders}) RETURNING *"
    )
    async with get_pool().acquire() as conn:
        r = await conn.fetchrow(sql, *story.values())
    return _row(r)


async def get_story(story_id: str) -> Optional[dict[str, Any]]:
    async with get_pool().acquire() as conn:
        r = await conn.fetchrow("SELECT * FROM stories WHERE id = $1", story_id)
    return _row(r)


async def get_story_by_external_id(external_id: str) -> Optional[dict[str, Any]]:
    async with get_pool().acquire() as conn:
        r = await conn.fetchrow(
            "SELECT * FROM stories WHERE external_id = $1", external_id
        )
    return _row(r)


async def update_story(story_id: str, fields: dict[str, Any]) -> Optional[dict[str, Any]]:
    if not fields:
        return await get_story(story_id)
    cols = list(fields.keys())
    set_clause = ", ".join(f"{c} = ${i+2}" for i, c in enumerate(cols))
    sql = f"UPDATE stories SET {set_clause} WHERE id = $1 RETURNING *"
    async with get_pool().acquire() as conn:
        r = await conn.fetchrow(sql, story_id, *fields.values())
    return _row(r)


async def delete_story(story_id: str) -> None:
    # ON DELETE CASCADE on saved_stories/story_personalizations/user_story_audio/
    # story_audio handles the child rows.
    async with get_pool().acquire() as conn:
        await conn.execute("DELETE FROM stories WHERE id = $1", story_id)


async def get_stories(
    *,
    category: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    conditions = []
    params: list[Any] = []
    if category:
        params.append(category)
        conditions.append(f"category = ${len(params)}")
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    params.extend([limit, offset])
    sql = (
        f"SELECT * FROM stories {where} "
        f"ORDER BY published_at DESC LIMIT ${len(params)-1} OFFSET ${len(params)}"
    )
    async with get_pool().acquire() as conn:
        rs = await conn.fetch(sql, *params)
    return _rows(rs)


async def count_stories(*, category: Optional[str] = None) -> int:
    if category:
        sql = "SELECT COUNT(*) FROM stories WHERE category = $1"
        params = [category]
    else:
        sql = "SELECT COUNT(*) FROM stories"
        params = []
    async with get_pool().acquire() as conn:
        return await conn.fetchval(sql, *params) or 0


async def get_stories_for_feed(published_since_days: int = 7) -> list[dict[str, Any]]:
    """Return all non-expired stories from the past N days for feed scoring."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=published_since_days)
    sql = (
        "SELECT * FROM stories "
        "WHERE published_at >= $1 AND (expires_at IS NULL OR expires_at > NOW()) "
        "ORDER BY published_at DESC LIMIT 200"
    )
    async with get_pool().acquire() as conn:
        rs = await conn.fetch(sql, cutoff)
    return _rows(rs)


# ── Saved stories ─────────────────────────────────────────────────────────────

async def save_story(user_id: str, story_id: str) -> dict[str, Any]:
    sql = (
        "INSERT INTO saved_stories (user_id, story_id) VALUES ($1, $2) "
        "ON CONFLICT (user_id, story_id) DO UPDATE SET saved_at = saved_stories.saved_at "
        "RETURNING *"
    )
    async with get_pool().acquire() as conn:
        r = await conn.fetchrow(sql, user_id, story_id)
    return _row(r) or {}


async def unsave_story(user_id: str, story_id: str) -> None:
    async with get_pool().acquire() as conn:
        await conn.execute(
            "DELETE FROM saved_stories WHERE user_id = $1 AND story_id = $2",
            user_id, story_id,
        )


async def get_saved_stories(user_id: str) -> list[dict[str, Any]]:
    sql = (
        "SELECT s.*, ss.saved_at FROM saved_stories ss "
        "JOIN stories s ON s.id = ss.story_id "
        "WHERE ss.user_id = $1 ORDER BY ss.saved_at DESC"
    )
    async with get_pool().acquire() as conn:
        rs = await conn.fetch(sql, user_id)
    return _rows(rs)


async def saved_story_count(story_id: str) -> int:
    async with get_pool().acquire() as conn:
        return await conn.fetchval(
            "SELECT COUNT(*) FROM saved_stories WHERE story_id = $1", story_id
        ) or 0


async def count_saved_stories(user_id: str) -> int:
    async with get_pool().acquire() as conn:
        return await conn.fetchval(
            "SELECT COUNT(*) FROM saved_stories WHERE user_id = $1", user_id
        ) or 0


async def is_story_saved(user_id: str, story_id: str) -> bool:
    async with get_pool().acquire() as conn:
        r = await conn.fetchval(
            "SELECT 1 FROM saved_stories WHERE user_id = $1 AND story_id = $2",
            user_id, story_id,
        )
    return r is not None


# ── Breaking news ──────────────────────────────────────────────────────────────

async def get_active_breaking_news() -> Optional[dict[str, Any]]:
    sql = (
        "SELECT * FROM breaking_news WHERE expires_at > NOW() "
        "ORDER BY created_at DESC LIMIT 1"
    )
    async with get_pool().acquire() as conn:
        r = await conn.fetchrow(sql)
    return _row(r)


async def insert_breaking_news(headline: str, link: str, ttl_hours: int = 6) -> dict[str, Any]:
    expires_at = datetime.now(timezone.utc) + timedelta(hours=ttl_hours)
    sql = (
        "INSERT INTO breaking_news (headline, link, expires_at) "
        "VALUES ($1, $2, $3) RETURNING *"
    )
    async with get_pool().acquire() as conn:
        r = await conn.fetchrow(sql, headline, link, expires_at)
    return _row(r)


async def dismiss_breaking_news(record_id: str) -> None:
    async with get_pool().acquire() as conn:
        await conn.execute("DELETE FROM breaking_news WHERE id = $1", record_id)


async def get_recent_breaking_news(limit: int = 10) -> list[dict[str, Any]]:
    sql = "SELECT * FROM breaking_news ORDER BY created_at DESC LIMIT $1"
    async with get_pool().acquire() as conn:
        rs = await conn.fetch(sql, limit)
    return _rows(rs)


# ── Users ─────────────────────────────────────────────────────────────────────

async def get_user(user_id: str) -> Optional[dict[str, Any]]:
    async with get_pool().acquire() as conn:
        r = await conn.fetchrow("SELECT * FROM users WHERE id = $1", user_id)
    return _row(r)


async def get_user_by_email(email: str) -> Optional[dict[str, Any]]:
    async with get_pool().acquire() as conn:
        r = await conn.fetchrow("SELECT * FROM users WHERE email = $1", email)
    return _row(r)


async def create_user(email: str, password_hash: str) -> dict[str, Any]:
    sql = (
        "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING *"
    )
    async with get_pool().acquire() as conn:
        r = await conn.fetchrow(sql, email, password_hash)
    return _row(r)


async def update_user(user_id: str, fields: dict[str, Any]) -> Optional[dict[str, Any]]:
    if not fields:
        return await get_user(user_id)
    cols = list(fields.keys())
    set_clause = ", ".join(f"{c} = ${i+2}" for i, c in enumerate(cols))
    sql = f"UPDATE users SET {set_clause} WHERE id = $1 RETURNING *"
    async with get_pool().acquire() as conn:
        r = await conn.fetchrow(sql, user_id, *fields.values())
    return _row(r)


async def list_users(limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
    sql = "SELECT * FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2"
    async with get_pool().acquire() as conn:
        rs = await conn.fetch(sql, limit, offset)
    return _rows(rs)


async def count_users() -> int:
    async with get_pool().acquire() as conn:
        return await conn.fetchval("SELECT COUNT(*) FROM users") or 0


async def delete_user_account(user_id: str) -> None:
    """Hard-delete a user and all associated data.

    Only deletes the row belonging to user_id — the caller must have already
    verified that user_id matches the authenticated requester's JWT sub claim.
    ON DELETE CASCADE handles saved_stories, user_preferences,
    story_personalizations, user_story_audio.
    """
    async with get_pool().acquire() as conn:
        await conn.execute("DELETE FROM users WHERE id = $1", user_id)
    log.info("delete_user_account: completed for %s", user_id)


# ── User preferences ──────────────────────────────────────────────────────────

async def get_preferences(user_id: str) -> Optional[dict[str, Any]]:
    async with get_pool().acquire() as conn:
        r = await conn.fetchrow(
            "SELECT * FROM user_preferences WHERE user_id = $1", user_id
        )
    return _row(r)


async def upsert_preferences(user_id: str, prefs: dict[str, Any]) -> dict[str, Any]:
    payload = {**prefs, "updated_at": datetime.now(timezone.utc)}
    cols = list(payload.keys())
    sql_cols = ", ".join(["user_id", *cols])
    placeholders = ", ".join(f"${i+2}" for i in range(len(cols)))
    update_clause = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols)
    sql = (
        f"INSERT INTO user_preferences ({sql_cols}) "
        f"VALUES ($1, {placeholders}) "
        f"ON CONFLICT (user_id) DO UPDATE SET {update_clause} "
        f"RETURNING *"
    )
    async with get_pool().acquire() as conn:
        r = await conn.fetchrow(sql, user_id, *payload.values())
    return _row(r) or payload


# ── App settings (persistent config) ─────────────────────────────────────────

async def get_app_setting(key: str) -> Optional[Any]:
    try:
        async with get_pool().acquire() as conn:
            r = await conn.fetchval(
                "SELECT value FROM app_settings WHERE key = $1", key
            )
        if r is None:
            return None
        import json
        return json.loads(r) if isinstance(r, str) else r
    except Exception as exc:
        log.warning("get_app_setting(%s) failed: %s", key, exc)
        return None


async def set_app_setting(key: str, value: Any) -> None:
    import json
    try:
        sql = (
            "INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW()) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()"
        )
        async with get_pool().acquire() as conn:
            await conn.execute(sql, key, json.dumps(value))
    except Exception as exc:
        log.warning("set_app_setting(%s) failed: %s", key, exc)


# ── Ingestion logs ─────────────────────────────────────────────────────────────

async def insert_ingestion_log(log_entry: dict[str, Any]) -> dict[str, Any]:
    cols = list(log_entry.keys())
    placeholders = ", ".join(f"${i+1}" for i in range(len(cols)))
    sql = f"INSERT INTO ingestion_logs ({', '.join(cols)}) VALUES ({placeholders}) RETURNING *"
    async with get_pool().acquire() as conn:
        r = await conn.fetchrow(sql, *log_entry.values())
    return _row(r)


async def get_ingestion_logs(limit: int = 10) -> list[dict[str, Any]]:
    sql = "SELECT * FROM ingestion_logs ORDER BY run_at DESC LIMIT $1"
    async with get_pool().acquire() as conn:
        rs = await conn.fetch(sql, limit)
    return _rows(rs)


# ── Story expiry cleanup ──────────────────────────────────────────────────────

async def get_expired_stories() -> list[dict[str, Any]]:
    sql = "SELECT id FROM stories WHERE expires_at < NOW()"
    async with get_pool().acquire() as conn:
        rs = await conn.fetch(sql)
    return _rows(rs)


async def extend_story_expiry(story_id: str, days: int = 30) -> None:
    new_expiry = datetime.now(timezone.utc) + timedelta(days=days)
    async with get_pool().acquire() as conn:
        await conn.execute(
            "UPDATE stories SET expires_at = $2 WHERE id = $1", story_id, new_expiry
        )


# ── Story personalizations ─────────────────────────────────────────────────────

async def get_personalization(user_id: str, story_id: str) -> Optional[dict[str, Any]]:
    try:
        async with get_pool().acquire() as conn:
            r = await conn.fetchrow(
                "SELECT personalized_text FROM story_personalizations "
                "WHERE user_id = $1 AND story_id = $2",
                user_id, story_id,
            )
        return _row(r)
    except Exception:
        return None


async def store_personalization(user_id: str, story_id: str, text: str) -> None:
    sql = (
        "INSERT INTO story_personalizations (user_id, story_id, personalized_text) "
        "VALUES ($1, $2, $3) "
        "ON CONFLICT (user_id, story_id) DO UPDATE SET personalized_text = EXCLUDED.personalized_text"
    )
    async with get_pool().acquire() as conn:
        await conn.execute(sql, user_id, story_id, text)


# ── Per-user full story audio ─────────────────────────────────────────────────

async def get_user_audio(user_id: str, story_id: str) -> Optional[bytes]:
    try:
        async with get_pool().acquire() as conn:
            r = await conn.fetchval(
                "SELECT mp3_data FROM user_story_audio WHERE user_id = $1 AND story_id = $2",
                user_id, story_id,
            )
        return bytes(r) if r is not None else None
    except Exception:
        return None


async def store_user_audio(user_id: str, story_id: str, mp3_bytes: bytes) -> None:
    sql = (
        "INSERT INTO user_story_audio (user_id, story_id, mp3_data) VALUES ($1, $2, $3) "
        "ON CONFLICT (user_id, story_id) DO UPDATE SET mp3_data = EXCLUDED.mp3_data"
    )
    async with get_pool().acquire() as conn:
        await conn.execute(sql, user_id, story_id, mp3_bytes)


# ── Story audio (shared, ingestion-time TTS) ───────────────────────────────────

async def get_story_audio(story_id: str) -> Optional[bytes]:
    async with get_pool().acquire() as conn:
        r = await conn.fetchval(
            "SELECT mp3_data FROM story_audio WHERE story_id = $1", story_id
        )
    return bytes(r) if r is not None else None


async def store_story_audio(story_id: str, mp3_bytes: bytes) -> None:
    sql = (
        "INSERT INTO story_audio (story_id, mp3_data) VALUES ($1, $2) "
        "ON CONFLICT (story_id) DO UPDATE SET mp3_data = EXCLUDED.mp3_data"
    )
    async with get_pool().acquire() as conn:
        await conn.execute(sql, story_id, mp3_bytes)


# ── Push tokens ─────────────────────────────────────────────────────────────────

async def get_push_tokens() -> list[str]:
    async with get_pool().acquire() as conn:
        rs = await conn.fetch("SELECT token FROM push_tokens")
    return [r["token"] for r in rs]


async def add_push_token(token: str) -> None:
    sql = "INSERT INTO push_tokens (token) VALUES ($1) ON CONFLICT (token) DO NOTHING"
    async with get_pool().acquire() as conn:
        await conn.execute(sql, token)


async def remove_push_token(token: str) -> None:
    async with get_pool().acquire() as conn:
        await conn.execute("DELETE FROM push_tokens WHERE token = $1", token)


async def push_token_count() -> int:
    async with get_pool().acquire() as conn:
        return await conn.fetchval("SELECT COUNT(*) FROM push_tokens") or 0


# ── Password reset tokens ──────────────────────────────────────────────────────

async def create_password_reset_token(user_id: str, token: str, ttl: timedelta) -> None:
    expires_at = datetime.now(timezone.utc) + ttl
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            # Invalidate any outstanding tokens for this user first.
            await conn.execute(
                "DELETE FROM password_reset_tokens WHERE user_id = $1", user_id
            )
            await conn.execute(
                "INSERT INTO password_reset_tokens (token, user_id, expires_at) "
                "VALUES ($1, $2, $3)",
                token, user_id, expires_at,
            )


async def consume_password_reset_token(token: str) -> Optional[str]:
    """Mark the token used and return its user_id, or None if invalid/expired/used."""
    sql = (
        "UPDATE password_reset_tokens SET used_at = NOW() "
        "WHERE token = $1 AND used_at IS NULL AND expires_at > NOW() "
        "RETURNING user_id"
    )
    async with get_pool().acquire() as conn:
        return await conn.fetchval(sql, token)
