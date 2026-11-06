"""Railway Postgres connection pool + typed helpers for all tables.

Replaces the old Supabase REST client. The backend is the only DB client —
there is no RLS layer — so every route is responsible for only ever passing
a user_id/story_id that the caller is actually allowed to touch (the JWT
'sub' claim, never a client-supplied id, for anything user-scoped).
"""
from __future__ import annotations

import json
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


_JSONB_COLUMNS = {"featured_posts"}


def _serialize(key: str, value: Any) -> Any:
    """asyncpg returns native datetime objects and raw JSON text for JSONB
    columns; the API/templates expect ISO strings and parsed JSON, matching
    the shape the old Supabase REST client returned."""
    if isinstance(value, datetime):
        return value.isoformat()
    if key in _JSONB_COLUMNS and isinstance(value, str):
        return json.loads(value)
    return value


def _row(r: Optional[asyncpg.Record]) -> Optional[dict[str, Any]]:
    if r is None:
        return None
    return {k: _serialize(k, v) for k, v in dict(r).items()}


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


async def delete_story(story_id: str) -> None:
    # ON DELETE CASCADE on saved_stories/story_personalizations handles those
    # child rows. Audio lives in S3, not Postgres — callers must delete the
    # S3 object separately (see services.ingestion.run_cleanup).
    async with get_pool().acquire() as conn:
        await conn.execute("DELETE FROM stories WHERE id = $1", story_id)


async def update_story_category(story_id: str, category: str) -> None:
    # Category is a CRRNT-side label, not source content, so editing it
    # needs no audio regeneration: the TTS script never mentions it.
    async with get_pool().acquire() as conn:
        await conn.execute(
            "UPDATE stories SET category = $2 WHERE id = $1", story_id, category
        )


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
        "WHERE (published_at IS NULL OR published_at >= $1) AND (expires_at IS NULL OR expires_at > NOW()) "
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
# password_hash is never included in any function below except
# get_user_with_password_hash — that is the only place it should be read,
# and only to verify a login attempt. Every route response goes through one
# of the other getters so a hash can never leak into an API response.

_USER_PUBLIC_COLUMNS = (
    "id, email, created_at, notification_consent, onboarding_complete, email_verified"
)


async def get_user(user_id: str) -> Optional[dict[str, Any]]:
    async with get_pool().acquire() as conn:
        r = await conn.fetchrow(
            f"SELECT {_USER_PUBLIC_COLUMNS} FROM users WHERE id = $1", user_id
        )
    return _row(r)


async def get_user_by_email(email: str) -> Optional[dict[str, Any]]:
    async with get_pool().acquire() as conn:
        r = await conn.fetchrow(
            f"SELECT {_USER_PUBLIC_COLUMNS} FROM users WHERE email = $1", email
        )
    return _row(r)


async def get_user_with_password_hash(email: str) -> Optional[dict[str, Any]]:
    """Only for verifying a login attempt — never return this dict from a route."""
    async with get_pool().acquire() as conn:
        r = await conn.fetchrow("SELECT * FROM users WHERE email = $1", email)
    return _row(r)


async def create_user(email: str, password_hash: str) -> dict[str, Any]:
    sql = (
        f"INSERT INTO users (email, password_hash) VALUES ($1, $2) "
        f"RETURNING {_USER_PUBLIC_COLUMNS}"
    )
    async with get_pool().acquire() as conn:
        r = await conn.fetchrow(sql, email, password_hash)
    return _row(r)


async def update_user(user_id: str, fields: dict[str, Any]) -> Optional[dict[str, Any]]:
    if not fields:
        return await get_user(user_id)
    cols = list(fields.keys())
    set_clause = ", ".join(f"{c} = ${i+2}" for i, c in enumerate(cols))
    sql = f"UPDATE users SET {set_clause} WHERE id = $1 RETURNING {_USER_PUBLIC_COLUMNS}"
    async with get_pool().acquire() as conn:
        r = await conn.fetchrow(sql, user_id, *fields.values())
    return _row(r)


async def list_users(limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
    sql = f"SELECT {_USER_PUBLIC_COLUMNS} FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2"
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


async def get_ingestion_totals() -> dict[str, int]:
    """All-time sums across every ingestion_logs row, for cost estimation."""
    sql = (
        "SELECT COALESCE(SUM(stories_fetched), 0) AS fetched, "
        "COALESCE(SUM(stories_enriched), 0) AS enriched, "
        "COALESCE(SUM(tts_generated), 0) AS tts_generated, "
        "COUNT(*) AS runs "
        "FROM ingestion_logs"
    )
    async with get_pool().acquire() as conn:
        r = await conn.fetchrow(sql)
    return {
        "fetched": r["fetched"],
        "enriched": r["enriched"],
        "tts_generated": r["tts_generated"],
        "runs": r["runs"],
    }


# ── Story expiry cleanup ──────────────────────────────────────────────────────

async def get_expired_stories() -> list[dict[str, Any]]:
    sql = "SELECT id, tts_url FROM stories WHERE expires_at < NOW()"
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


# ── Story audio (S3 object key, generated once at ingestion) ──────────────────

async def update_story_tts_key(story_id: str, s3_key: str) -> None:
    async with get_pool().acquire() as conn:
        await conn.execute(
            "UPDATE stories SET tts_url = $2 WHERE id = $1", story_id, s3_key
        )


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


# ── Anonymous metrics ─────────────────────────────────────────────────────────
# Privacy: install_counts is aggregate-only (one row per day per platform,
# no identifiers). devices is keyed by a random UUID generated on the
# device — never joined to accounts, names, emails, or IPs. Stale device
# rows are purged on every heartbeat write so retention is self-enforcing.


async def record_install(platform: str) -> None:
    sql = """INSERT INTO install_counts (day, platform, count)
             VALUES (CURRENT_DATE, $1, 1)
             ON CONFLICT (day, platform)
             DO UPDATE SET count = install_counts.count + 1"""
    async with get_pool().acquire() as conn:
        await conn.execute(sql, platform)


async def record_device(
    device_id: str, platform: str, app_version: str, internal: bool = False
) -> None:
    # is_internal is sticky-true: a device that has ever self-marked as the
    # owner's test device (or been marked in the admin portal) stays marked
    # until an admin unmarks it — a plain heartbeat must not clear the flag.
    sql = """INSERT INTO devices (device_id, platform, app_version, is_internal)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (device_id) DO UPDATE
               SET last_seen = NOW(),
                   platform = EXCLUDED.platform,
                   app_version = EXCLUDED.app_version,
                   is_internal = devices.is_internal OR EXCLUDED.is_internal"""
    async with get_pool().acquire() as conn:
        await conn.execute(sql, device_id, platform, app_version, internal)
        # Self-enforcing retention: drop devices silent for 90 days.
        await conn.execute(
            "DELETE FROM devices WHERE last_seen < NOW() - INTERVAL '90 days'"
        )
        # Analytics events age out with their devices and on their own
        # after 90 days. Guarded: until migration 005 has run on this
        # database the table does not exist, and a heartbeat must not
        # fail over a cleanup step — the failure is logged, not hidden.
        try:
            await conn.execute(
                "DELETE FROM analytics_events WHERE device_id NOT IN "
                "(SELECT device_id FROM devices)"
            )
            await conn.execute(
                "DELETE FROM analytics_events "
                "WHERE created_at < NOW() - INTERVAL '90 days'"
            )
        except Exception as exc:
            log.warning("Analytics events purge skipped: %s", exc)


async def install_totals() -> dict:
    """Aggregate install counts: totals plus per-day rows (14 days) with a
    per-platform split, for the admin dashboard. No device data involved."""
    async with get_pool().acquire() as conn:
        total = await conn.fetchval("SELECT COALESCE(SUM(count), 0) FROM install_counts") or 0
        today = (
            await conn.fetchval(
                "SELECT COALESCE(SUM(count), 0) FROM install_counts WHERE day = CURRENT_DATE"
            )
            or 0
        )
        last7 = (
            await conn.fetchval(
                "SELECT COALESCE(SUM(count), 0) FROM install_counts "
                "WHERE day >= CURRENT_DATE - 6"
            )
            or 0
        )
        rows = await conn.fetch(
            "SELECT day, platform, count FROM install_counts "
            "ORDER BY day DESC, platform"
        )
    daily: dict[str, dict] = {}
    for r in rows:
        day = str(r["day"])
        entry = daily.setdefault(day, {"day": day, "total": 0, "ios": 0, "android": 0, "web": 0})
        entry["total"] += r["count"]
        if r["platform"] in ("ios", "android", "web"):
            entry[r["platform"]] += r["count"]
    return {
        "total": total,
        "today": today,
        "last7": last7,
        "daily": sorted(daily.values(), key=lambda d: d["day"], reverse=True)[:14],
    }


async def device_stats() -> dict:
    """Retention snapshot from the anonymous device table: total devices
    ever seen (within the 90-day retention window) plus devices active in
    the last 7 / 30 days."""
    async with get_pool().acquire() as conn:
        total = await conn.fetchval("SELECT COUNT(*) FROM devices") or 0
        active7 = (
            await conn.fetchval(
                "SELECT COUNT(*) FROM devices WHERE last_seen >= NOW() - INTERVAL '7 days'"
            )
            or 0
        )
        active30 = (
            await conn.fetchval(
                "SELECT COUNT(*) FROM devices WHERE last_seen >= NOW() - INTERVAL '30 days'"
            )
            or 0
        )
    return {"total": total, "active7": active7, "active30": active30}


# ── Internal product analytics ────────────────────────────────────────────────
# Product events (story views, completions, saves, screen views…) stored in
# CRRNT's own database — the PostHog replacement. Rows are keyed only by the
# anonymous device UUID. Headline aggregates EXCLUDE devices marked
# is_internal (the owner's test devices, which previously inflated every
# count); the device list shows every device so they can be spotted and
# marked. All bucketing is in America/New_York, the app's home timezone.

_INTERNAL_FILTER = (
    "NOT EXISTS (SELECT 1 FROM devices d "
    "WHERE d.device_id = e.device_id AND d.is_internal)"
)


async def record_event(
    device_id: str,
    event: str,
    story_id: str | None,
    category: str | None,
    platform: str,
    app_version: str,
    internal: bool = False,
) -> None:
    """Store one product event and keep the device row fresh (last_seen,
    plus the sticky is_internal flag when the device self-marks)."""
    async with get_pool().acquire() as conn:
        await conn.execute(
            """INSERT INTO devices (device_id, platform, app_version, is_internal)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (device_id) DO UPDATE
                 SET last_seen = NOW(),
                     platform = EXCLUDED.platform,
                     app_version = EXCLUDED.app_version,
                     is_internal = devices.is_internal OR EXCLUDED.is_internal""",
            device_id, platform, app_version, internal,
        )
        await conn.execute(
            """INSERT INTO analytics_events
                 (device_id, event, story_id, category, platform, app_version)
               VALUES ($1, $2, $3, $4, $5, $6)""",
            device_id, event, story_id, category, platform, app_version,
        )


async def analytics_summary() -> dict:
    """Headline numbers for the admin Analytics page, internal devices
    excluded: story views and completions (all time + today), unique
    active devices (today / 7d / 30d, from events), total events."""
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow(
            f"""SELECT
                  COUNT(*) FILTER (WHERE e.event = 'story_opened') AS views_total,
                  COUNT(*) FILTER (WHERE e.event = 'story_opened'
                    AND (e.created_at AT TIME ZONE 'America/New_York')::date
                      = (NOW() AT TIME ZONE 'America/New_York')::date) AS views_today,
                  COUNT(*) FILTER (WHERE e.event = 'story_completed') AS completions_total,
                  COUNT(*) AS events_total,
                  COUNT(DISTINCT e.device_id) FILTER (WHERE
                    (e.created_at AT TIME ZONE 'America/New_York')::date
                      = (NOW() AT TIME ZONE 'America/New_York')::date) AS users_today,
                  COUNT(DISTINCT e.device_id) FILTER (WHERE
                    e.created_at >= NOW() - INTERVAL '7 days') AS users_7d,
                  COUNT(DISTINCT e.device_id) FILTER (WHERE
                    e.created_at >= NOW() - INTERVAL '30 days') AS users_30d
                FROM analytics_events e
                WHERE {_INTERNAL_FILTER}"""
        )
        internal_devices = (
            await conn.fetchval("SELECT COUNT(*) FROM devices WHERE is_internal") or 0
        )
    views_total = row["views_total"] or 0
    completions_total = row["completions_total"] or 0
    return {
        "views_total": views_total,
        "views_today": row["views_today"] or 0,
        "completions_total": completions_total,
        "completion_rate": (
            round(completions_total / views_total * 100, 1) if views_total else 0
        ),
        "events_total": row["events_total"] or 0,
        "users_today": row["users_today"] or 0,
        "users_7d": row["users_7d"] or 0,
        "users_30d": row["users_30d"] or 0,
        "internal_devices": internal_devices,
    }


# granularity → (date_trunc unit, spine span, bucket count, label format)
_SERIES_SPECS = {
    "hour": ("hour", "23 hours", 24, "HH24:00"),
    "day": ("day", "29 days", 30, "Mon DD"),
    "week": ("week", "11 weeks", 12, "Mon DD"),
    "month": ("month", "11 months", 12, "Mon YYYY"),
    "year": ("year", "4 years", 5, "YYYY"),
}


async def analytics_series(granularity: str) -> list[dict]:
    """Story views + active devices per time bucket, oldest first, with
    empty buckets zero-filled. Internal devices excluded."""
    unit, span, _count, label_fmt = _SERIES_SPECS[granularity]
    sql = f"""
        WITH spine AS (
          SELECT generate_series(
            date_trunc('{unit}', NOW() AT TIME ZONE 'America/New_York')
              - INTERVAL '{span}',
            date_trunc('{unit}', NOW() AT TIME ZONE 'America/New_York'),
            INTERVAL '1 {unit}'
          ) AS bucket
        )
        SELECT
          to_char(s.bucket, '{label_fmt}') AS label,
          COUNT(e.id) FILTER (WHERE e.event = 'story_opened') AS story_views,
          COUNT(DISTINCT e.device_id) AS active_users,
          COUNT(e.id) AS events
        FROM spine s
        LEFT JOIN analytics_events e
          ON date_trunc('{unit}', e.created_at AT TIME ZONE 'America/New_York')
             = s.bucket
         AND {_INTERNAL_FILTER}
        GROUP BY s.bucket
        ORDER BY s.bucket
    """
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(sql)
    return [
        {
            "label": r["label"],
            "story_views": r["story_views"] or 0,
            "active_users": r["active_users"] or 0,
            "events": r["events"] or 0,
        }
        for r in rows
    ]


async def analytics_top_stories(days: int = 7, limit: int = 15) -> list[dict]:
    """Most-viewed stories in the window: views, completions, unique
    readers. Internal devices excluded. Stories that have expired out of
    the 7-day feed still appear (title resolved when the row still
    exists; otherwise the story id stands alone)."""
    sql = f"""
        SELECT
          e.story_id,
          COALESCE(s.display_title, s.title) AS title,
          s.category AS story_category,
          COUNT(*) FILTER (WHERE e.event = 'story_opened') AS views,
          COUNT(*) FILTER (WHERE e.event = 'story_completed') AS completions,
          COUNT(DISTINCT e.device_id) FILTER
            (WHERE e.event = 'story_opened') AS readers
        FROM analytics_events e
        LEFT JOIN stories s ON s.id::text = e.story_id
        WHERE e.story_id IS NOT NULL
          AND e.created_at >= NOW() - INTERVAL '{int(days)} days'
          AND {_INTERNAL_FILTER}
        GROUP BY e.story_id, s.display_title, s.title, s.category
        HAVING COUNT(*) FILTER (WHERE e.event = 'story_opened') > 0
        ORDER BY views DESC
        LIMIT {int(limit)}
    """
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(sql)
    return [dict(r) for r in rows]


async def analytics_devices(limit: int = 50) -> list[dict]:
    """Every known device with its activity, newest activity first —
    internal devices included and flagged, so the owner can spot their
    own test devices and mark any that are unmarked."""
    sql = """
        SELECT
          d.device_id, d.platform, d.app_version, d.is_internal,
          d.first_seen, d.last_seen,
          COUNT(e.id) AS events,
          COUNT(e.id) FILTER (WHERE e.event = 'story_opened') AS story_views
        FROM devices d
        LEFT JOIN analytics_events e ON e.device_id = d.device_id
        GROUP BY d.device_id
        ORDER BY d.last_seen DESC
        LIMIT $1
    """
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(sql, limit)
    return [dict(r) for r in rows]


async def set_device_internal(device_id: str, internal: bool) -> None:
    async with get_pool().acquire() as conn:
        await conn.execute(
            "UPDATE devices SET is_internal = $2 WHERE device_id = $1",
            device_id, internal,
        )


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


# ── Beta feedback ─────────────────────────────────────────────────────────────
async def insert_feedback(message: str, platform: str | None, app_version: str | None) -> dict[str, Any]:
    sql = (
        "INSERT INTO beta_feedback (message, platform, app_version) "
        "VALUES ($1, $2, $3) RETURNING *"
    )
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow(sql, message, platform, app_version)
    return _row(row) or {}


async def list_feedback(limit: int = 100) -> list[dict[str, Any]]:
    sql = "SELECT * FROM beta_feedback ORDER BY created_at DESC LIMIT $1"
    async with get_pool().acquire() as conn:
        rs = await conn.fetch(sql, limit)
    return _rows(rs)


async def get_unemailed_feedback() -> list[dict[str, Any]]:
    sql = "SELECT * FROM beta_feedback WHERE emailed_at IS NULL ORDER BY created_at ASC"
    async with get_pool().acquire() as conn:
        rs = await conn.fetch(sql)
    return _rows(rs)


async def mark_feedback_emailed(ids: list[str]) -> None:
    if not ids:
        return
    sql = "UPDATE beta_feedback SET emailed_at = NOW() WHERE id = ANY($1::uuid[])"
    async with get_pool().acquire() as conn:
        await conn.execute(sql, ids)


async def mark_feedback_reviewed(feedback_id: str) -> None:
    sql = "UPDATE beta_feedback SET reviewed_at = NOW() WHERE id = $1::uuid"
    async with get_pool().acquire() as conn:
        await conn.execute(sql, feedback_id)


async def delete_feedback(feedback_id: str) -> None:
    sql = "DELETE FROM beta_feedback WHERE id = $1::uuid"
    async with get_pool().acquire() as conn:
        await conn.execute(sql, feedback_id)


# ── Notifications ─────────────────────────────────────────────────────────────
async def get_recently_inserted_stories(cutoff, limit: int = 50) -> list[dict[str, Any]]:
    """Stories inserted (created_at) after `cutoff`, newest-published first —
    the feed's own order, so stories[0] is the Morning Edition's top story."""
    sql = (
        "SELECT * FROM stories WHERE created_at >= $1 "
        "ORDER BY published_at DESC NULLS LAST LIMIT $2"
    )
    async with get_pool().acquire() as conn:
        rs = await conn.fetch(sql, cutoff, limit)
    return _rows(rs)
