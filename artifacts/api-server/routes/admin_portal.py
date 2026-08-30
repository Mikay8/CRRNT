"""Admin portal — Jinja2 HTML pages with HTTP Basic Auth.

Routes:
  GET  /admin                → redirect to /admin/dashboard
  GET  /admin/dashboard
  GET  /admin/stories
  GET  /admin/users
  GET  /admin/breaking
  GET  /admin/settings

Actions (POST, redirect back):
  POST /admin/ingest
  POST /admin/cleanup
  POST /admin/breaking/create
  POST /admin/breaking/{id}/dismiss
  POST /admin/stories/{id}/delete
  POST /admin/settings/save

"""

from __future__ import annotations

import os
import secrets
import logging
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.templating import Jinja2Templates

from services import app_settings, db, ingestion, ingest_config, log_buffer, metrics, scheduler

log = logging.getLogger("crrnt.admin")

TEMPLATES_DIR = Path(__file__).parent.parent / "templates"
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

router = APIRouter(prefix="/admin", tags=["admin-portal"])
_basic = HTTPBasic(auto_error=False)


# ── Auth ──────────────────────────────────────────────────────────────────────


def _verify_admin(
    creds: Optional[HTTPBasicCredentials] = Depends(_basic),
) -> None:
    admin_user = os.environ.get("ADMIN_USERNAME", "admin")
    admin_pass = os.environ.get("ADMIN_PASSWORD", "")

    if not admin_pass:
        raise HTTPException(
            status_code=503,
            detail="Admin portal not configured (ADMIN_PASSWORD not set)",
        )

    if not creds:
        raise HTTPException(
            status_code=401,
            headers={"WWW-Authenticate": 'Basic realm="CRRNT Admin"'},
            detail="Authentication required",
        )

    ok_user = secrets.compare_digest(creds.username.encode(), admin_user.encode())
    ok_pass = secrets.compare_digest(creds.password.encode(), admin_pass.encode())
    if not (ok_user and ok_pass):
        raise HTTPException(
            status_code=401,
            headers={"WWW-Authenticate": 'Basic realm="CRRNT Admin"'},
            detail="Invalid credentials",
        )


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _safe_db(coro, default):
    try:
        return await coro
    except Exception as exc:
        log.warning("Admin DB call failed: %s", exc)
        return default


def _ingestion_cfg() -> dict[str, Any]:
    per_cat = int(os.environ.get("INGESTION_PER_CATEGORY", "10"))
    return {"per_category": per_cat}


# ── Dashboard ─────────────────────────────────────────────────────────────────


@router.get("", response_class=RedirectResponse)
@router.get("/", response_class=RedirectResponse)
async def admin_root(_: None = Depends(_verify_admin)):
    return RedirectResponse(url="/admin/dashboard", status_code=302)


@router.get("/dashboard", response_class=HTMLResponse)
async def dashboard(request: Request, _: None = Depends(_verify_admin)):
    total_stories = await _safe_db(db.count_stories(), 0)
    total_users = await _safe_db(db.count_users(), 0)
    ingest_logs = await _safe_db(db.get_ingestion_logs(limit=5), [])
    breaking = await _safe_db(db.get_active_breaking_news(), None)
    ingest_status = ingestion.get_status()
    recent_logs = log_buffer.get_logs()
    scheduled_jobs = scheduler.get_job_status()

    return templates.TemplateResponse(
        request,
        "admin/dashboard.html",
        {
            "page": "dashboard",
            "total_stories": total_stories,
            "total_users": total_users,
            "ingest_logs": ingest_logs,
            "breaking": breaking,
            "ingest_status": ingest_status,
            "recent_logs": recent_logs,
            "scheduled_jobs": scheduled_jobs,
        },
    )


# ── Stories ───────────────────────────────────────────────────────────────────


@router.get("/stories", response_class=HTMLResponse)
async def admin_stories(
    request: Request,
    category: Optional[str] = None,
    _: None = Depends(_verify_admin),
):
    stories = await _safe_db(
        db.get_stories(category=category or None, limit=100),
        [],
    )
    total = await _safe_db(db.count_stories(), 0)
    return templates.TemplateResponse(
        request,
        "admin/stories.html",
        {
            "page": "stories",
            "stories": stories,
            "total": total,
            "filter_category": category or "",
            "categories": [
                "celebrity",
                "tech",
                "government",
                "sports",
                "business",
                "science",
                "entertainment",
            ],
        },
    )


@router.post("/stories/{story_id}/delete")
async def delete_story(story_id: str, _: None = Depends(_verify_admin)):
    await _safe_db(db.delete_story(story_id), None)
    return RedirectResponse(url="/admin/stories", status_code=302)


# ── Users ─────────────────────────────────────────────────────────────────────


@router.get("/users", response_class=HTMLResponse)
async def admin_users(
    request: Request,
    _: None = Depends(_verify_admin),
):
    users = await _safe_db(db.list_users(limit=100), [])
    total = await _safe_db(db.count_users(), 0)
    return templates.TemplateResponse(
        request,
        "admin/users.html",
        {
            "page": "users",
            "users": users,
            "total": total,
        },
    )


# ── Breaking news ─────────────────────────────────────────────────────────────


@router.get("/breaking", response_class=HTMLResponse)
async def admin_breaking(request: Request, _: None = Depends(_verify_admin)):
    active = await _safe_db(db.get_active_breaking_news(), None)
    recent = await _safe_db(db.get_recent_breaking_news(limit=10), [])
    return templates.TemplateResponse(
        request,
        "admin/breaking.html",
        {
            "page": "breaking",
            "active": active,
            "recent": recent,
        },
    )


@router.post("/breaking/create")
async def create_breaking(
    headline: str = Form(...),
    link: str = Form(""),
    ttl_hours: int = Form(6),
    _: None = Depends(_verify_admin),
):
    await _safe_db(db.insert_breaking_news(headline, link, ttl_hours), None)
    return RedirectResponse(url="/admin/breaking", status_code=302)


@router.post("/breaking/{record_id}/dismiss")
async def dismiss_breaking(record_id: str, _: None = Depends(_verify_admin)):
    await _safe_db(db.dismiss_breaking_news(record_id), None)
    return RedirectResponse(url="/admin/breaking", status_code=302)


# ── Settings ──────────────────────────────────────────────────────────────────


@router.get("/settings", response_class=HTMLResponse)
async def admin_settings(request: Request, _: None = Depends(_verify_admin)):
    cfg = await ingest_config.get()
    feed_limits = await app_settings.get_feed_limits()
    story_expiry = await app_settings.get_story_expiry()
    admin_emails = await app_settings.get_admin_emails()
    schedule_times = await app_settings.get_schedule_times()
    env_status = {
        "DATABASE_URL": bool(os.environ.get("DATABASE_URL")),
        "JWT_SECRET": bool(os.environ.get("JWT_SECRET")),
        "ANTHROPIC_API_KEY": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "NEWSMESH_API_KEY": bool(os.environ.get("NEWSMESH_API_KEY")),
        "XAPI_KEY": bool(os.environ.get("XAPI_KEY")),
        "FISH_AUDIO_API_KEY": bool(os.environ.get("FISH_AUDIO_API_KEY")),
        "ADMIN_PASSWORD": bool(os.environ.get("ADMIN_PASSWORD")),
        "RESEND_API_KEY": bool(os.environ.get("RESEND_API_KEY")),
        "SMTP_HOST": bool(os.environ.get("SMTP_HOST")),
        "SMTP_USER": bool(os.environ.get("SMTP_USER")),
        "SMTP_PASS": bool(os.environ.get("SMTP_PASS")),
        "S3_BUCKET": bool(os.environ.get("S3_BUCKET")),
        "S3_ENDPOINT": bool(os.environ.get("S3_ENDPOINT")),
        "S3_ACCESS_KEY_ID": bool(os.environ.get("S3_ACCESS_KEY_ID")),
        "S3_SECRET_ACCESS_KEY": bool(os.environ.get("S3_SECRET_ACCESS_KEY")),
        "S3_REGION": bool(os.environ.get("S3_REGION")),
    }
    system_info = [
        {"label": "Schedule", "value": "08:00 America/New_York (daily)"},
        {"label": "Cleanup", "value": "03:00 America/New_York (daily)"},
        {"label": "NewsMesh daily quota", "value": "25 requests/day"},
    ]
    return templates.TemplateResponse(
        request,
        "admin/settings.html",
        {
            "page": "settings",
            "cfg": cfg,
            "feed_limits": feed_limits,
            "story_expiry": story_expiry,
            "admin_emails": admin_emails,
            "schedule_times": schedule_times,
            "env_status": env_status,
            "system_info": system_info,
        },
    )


def _parse_ingest_config(form: dict) -> dict:
    """Parse submitted form data into an ingest_config dict."""
    mode = form.get("mode", "category")
    categories = {}
    for cat in ingest_config.ALL_CATEGORIES:
        enabled = form.get(f"cat_enabled_{cat}") == "1"
        try:
            count = max(1, min(10, int(form.get(f"cat_count_{cat}", 10))))
        except (TypeError, ValueError):
            count = 10
        categories[cat] = {"enabled": enabled, "count": count}
    try:
        trending_count = max(1, min(25, int(form.get("trending_count", 25))))
    except (TypeError, ValueError):
        trending_count = 25
    return {"mode": mode, "categories": categories, "trending_count": trending_count}


@router.post("/ingest-config/save")
async def save_ingest_config(request: Request, _: None = Depends(_verify_admin)):
    form = dict(await request.form())
    cfg = _parse_ingest_config(form)
    await ingest_config.save(cfg)
    return RedirectResponse(url="/admin/settings", status_code=302)


@router.post("/ingest-config/save-and-run")
async def save_and_run_ingest(request: Request, _: None = Depends(_verify_admin)):
    import asyncio
    form = dict(await request.form())
    cfg = _parse_ingest_config(form)
    await ingest_config.save(cfg)
    params = await ingest_config.get_run_params()
    asyncio.create_task(ingestion.run_ingestion(**params))
    return RedirectResponse(url="/admin/dashboard", status_code=302)


@router.post("/feed-limits/save")
async def save_feed_limits(request: Request, _: None = Depends(_verify_admin)):
    form = dict(await request.form())
    try:
        daily = max(1, min(100, int(form.get("daily_limit", 15))))
    except (TypeError, ValueError):
        daily = 15
    await app_settings.save_feed_limits(daily)
    return RedirectResponse(url="/admin/settings", status_code=302)


@router.post("/schedule/save")
async def save_schedule(request: Request, _: None = Depends(_verify_admin)):
    from services import scheduler as sched
    form = dict(await request.form())
    try:
        ih, im = map(int, form.get("ingest_time", "08:00").split(":"))
        ch, cm = map(int, form.get("cleanup_time", "03:00").split(":"))
        ih = max(0, min(23, ih)); im = max(0, min(59, im))
        ch = max(0, min(23, ch)); cm = max(0, min(59, cm))
    except (ValueError, AttributeError):
        ih, im, ch, cm = 8, 0, 3, 0
    await app_settings.save_schedule_times(ih, im, ch, cm)
    sched.reschedule(ih, im, ch, cm)
    return RedirectResponse(url="/admin/settings", status_code=302)


@router.post("/admin-emails/save")
async def save_admin_emails(request: Request, _: None = Depends(_verify_admin)):
    form = dict(await request.form())
    raw = form.get("emails", "")
    emails = [e.strip() for e in raw.replace(",", "\n").splitlines() if e.strip()]
    await app_settings.save_admin_emails(emails)
    return RedirectResponse(url="/admin/settings", status_code=302)


@router.post("/story-expiry/save")
async def save_story_expiry(request: Request, _: None = Depends(_verify_admin)):
    form = dict(await request.form())
    try:
        days = max(1, min(90, int(form.get("expiry_days", 7))))
        extension_days = max(7, min(365, int(form.get("extension_days", 30))))
    except (TypeError, ValueError):
        days, extension_days = 7, 30
    await app_settings.save_story_expiry(days, extension_days)
    return RedirectResponse(url="/admin/settings", status_code=302)


# ── Service logs ──────────────────────────────────────────────────────────────


@router.get("/logs", response_class=HTMLResponse)
async def admin_logs(request: Request, _: None = Depends(_verify_admin)):
    return templates.TemplateResponse(
        request,
        "admin/logs.html",
        {
            "page": "logs",
            "logs": log_buffer.get_logs(),
        },
    )


# ── API usage ─────────────────────────────────────────────────────────────────


def _dashboard_links() -> list[dict]:
    return [
        {
            "name": "Anthropic (Claude)",
            "description": "Token usage, cost, rate limits for Claude enrichment",
            "url": os.environ.get(
                "ANTHROPIC_DASHBOARD_URL",
                "https://console.anthropic.com/settings/usage",
            ),
        },
        {
            "name": "Railway",
            "description": "Postgres database, deploys, and service usage/billing",
            "url": os.environ.get(
                "RAILWAY_DASHBOARD_URL",
                "https://railway.app/dashboard",
            ),
        },
        {
            "name": "NewsMesh",
            "description": "Daily request quota and news API usage",
            "url": os.environ.get(
                "NEWSMESH_DASHBOARD_URL", "https://newsmesh.co/dashboard"
            ),
        },
        {
            "name": "GetXAPI (Twitter/X)",
            "description": "Tweet search quota and API usage",
            "url": os.environ.get(
                "XAPI_DASHBOARD_URL", "https://getxapi.com/dashboard"
            ),
        },
        {
            "name": "Fish Audio (TTS)",
            "description": "TTS character usage and billing",
            "url": os.environ.get(
                "FISH_AUDIO_DASHBOARD_URL", "https://fish.audio/app/"
            ),
        },
    ]


# Rough, clearly-labeled cost estimate — not wired to real token/character
# counts (those aren't tracked per-call), so this is a ballpark only.
# Claude Haiku 4.5 ~$1/$5 per M input/output tokens; enrichment runs one
# pass per story (~1200 input + ~700 output tokens) unless X API sentiment
# is enabled (adds a second, smaller pass).
_CLAUDE_INPUT_TOKENS_PER_STORY = 1200
_CLAUDE_OUTPUT_TOKENS_PER_STORY = 700
_CLAUDE_INPUT_COST_PER_M = 1.00
_CLAUDE_OUTPUT_COST_PER_M = 5.00
# Fish Audio ~$15 per M characters; a full story script is ~600 characters.
_FISH_AUDIO_CHARS_PER_STORY = 600
_FISH_AUDIO_COST_PER_M_CHARS = 15.00


def _estimate_cost(totals: dict[str, int]) -> dict[str, Any]:
    enriched = totals.get("enriched", 0)
    tts = totals.get("tts_generated", 0)

    claude_cost = (
        enriched * _CLAUDE_INPUT_TOKENS_PER_STORY / 1_000_000 * _CLAUDE_INPUT_COST_PER_M
        + enriched * _CLAUDE_OUTPUT_TOKENS_PER_STORY / 1_000_000 * _CLAUDE_OUTPUT_COST_PER_M
    )
    fish_cost = tts * _FISH_AUDIO_CHARS_PER_STORY / 1_000_000 * _FISH_AUDIO_COST_PER_M_CHARS

    return {
        "enriched": enriched,
        "tts": tts,
        "claude_cost": round(claude_cost, 2),
        "fish_cost": round(fish_cost, 2),
        "total_cost": round(claude_cost + fish_cost, 2),
    }


@router.get("/usage", response_class=HTMLResponse)
async def admin_usage(request: Request, _: None = Depends(_verify_admin)):
    rows = metrics.get_all()
    total_calls = sum(r["calls"] for r in rows)
    total_errors = sum(r["errors"] for r in rows)
    error_rate = round(total_errors / total_calls * 100, 1) if total_calls else 0
    ingestion_totals = await _safe_db(
        db.get_ingestion_totals(), {"fetched": 0, "enriched": 0, "tts_generated": 0}
    )
    cost_estimate = _estimate_cost(ingestion_totals)
    return templates.TemplateResponse(
        request,
        "admin/usage.html",
        {
            "page": "usage",
            "rows": rows,
            "total_calls": total_calls,
            "total_errors": total_errors,
            "error_rate": error_rate,
            "endpoints": len(rows),
            "dashboards": _dashboard_links(),
            "cost_estimate": cost_estimate,
        },
    )


@router.post("/usage/reset")
async def reset_usage(_: None = Depends(_verify_admin)):
    metrics.reset()
    return RedirectResponse(url="/admin/usage", status_code=302)


# ── Ingestion actions ─────────────────────────────────────────────────────────


@router.post("/ingest")
async def trigger_ingest(_: None = Depends(_verify_admin)):
    import asyncio

    params = await ingest_config.get_run_params()
    asyncio.create_task(ingestion.run_ingestion(**params))
    return RedirectResponse(url="/admin/dashboard", status_code=302)


@router.post("/cleanup")
async def trigger_cleanup(_: None = Depends(_verify_admin)):
    import asyncio

    asyncio.create_task(ingestion.run_cleanup())
    return RedirectResponse(url="/admin/dashboard", status_code=302)


@router.post("/test-email")
async def test_email(_: None = Depends(_verify_admin)):
    from services import email_service
    await email_service.send_digest(
        stories=[
            {"title": "Test Story One", "category": "tech"},
            {"title": "Test Story Two", "category": "business"},
        ],
        cleanup={"deleted": 3, "extended": 1},
    )
    recipients = await app_settings.get_admin_emails()
    return {"sent_to": recipients, "note": "Check server logs if email did not arrive"}
