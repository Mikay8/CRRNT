"""CRRNT FastAPI server.

Architecture v3:
  - All data stored in Railway PostgreSQL (asyncpg connection pool)
  - Local JWT auth (bcrypt password hashing, JWT validated per-request)
  - APScheduler for daily ingestion (08:00 ET) and cleanup (03:00 ET)
  - Jinja2 admin portal at /admin (HTTP Basic Auth)
"""
from __future__ import annotations

import logging
import os
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from routes import health, stocks
from routes import auth as auth_routes
from routes import stories as stories_routes
from routes import onboarding as onboarding_routes
from routes import admin_portal
from services import db, log_buffer, scheduler, metrics, rate_limit
from services.rate_limit import SlidingWindowLimiter

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("crrnt")
log.addHandler(log_buffer.handler)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    log.info("CRRNT API v3 starting up")

    if not os.environ.get("DATABASE_URL"):
        log.warning("DATABASE_URL is not set — database calls will fail")
    else:
        await db.init_pool()

    if not os.environ.get("JWT_SECRET"):
        log.warning("JWT_SECRET is not set — auth will fail")

    await scheduler.start()

    try:
        yield
    finally:
        scheduler.shutdown()
        await db.close_pool()
        log.info("CRRNT API shutting down")


app = FastAPI(
    title="CRRNT API",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


_general_limiter = SlidingWindowLimiter(limit=60, window=60.0)
_expensive_limiter = SlidingWindowLimiter(limit=10, window=60.0)
_EXPENSIVE_SEGMENTS = ("/audio", "/personalized-audio")


@app.middleware("http")
async def _rate_limit_middleware(request: Request, call_next):
    # /admin is limited separately (failed logins, see admin_portal._verify_admin)
    # so its auto-refreshing logs page doesn't eat into a general budget.
    path = request.url.path
    if path.startswith("/admin") or "/health" in path:
        return await call_next(request)

    is_expensive = any(seg in path for seg in _EXPENSIVE_SEGMENTS)
    limiter = _expensive_limiter if is_expensive else _general_limiter
    key = rate_limit.client_ip(request)

    retry_after = limiter.retry_after(key)
    if retry_after:
        return JSONResponse(
            status_code=429,
            content={"detail": f"Rate limit exceeded. Try again in {retry_after} seconds."},
            headers={"Retry-After": str(retry_after)},
        )

    limiter.record(key)
    return await call_next(request)


@app.middleware("http")
async def _metrics_middleware(request: Request, call_next):
    start = time.monotonic()
    response = await call_next(request)
    elapsed_ms = (time.monotonic() - start) * 1000
    metrics.record(request.method, request.url.path, response.status_code, elapsed_ms)
    return response

# ── API routes ────────────────────────────────────────────────────────────────
app.include_router(health.router, prefix="/api")
app.include_router(stocks.router, prefix="/api")
app.include_router(auth_routes.router)          # already prefixed /api/auth
app.include_router(stories_routes.router)       # already prefixed /api/stories
app.include_router(onboarding_routes.router)    # already prefixed /api/onboarding

# ── Legacy push token endpoint (backward compat with old app installs) ────────
from fastapi import Request
from pydantic import BaseModel

class PushTokenBody(BaseModel):
    token: str

@app.post("/api/push-token", tags=["push"])
async def register_push_token(body: PushTokenBody) -> dict:
    try:
        from services import push
        await push.add_token(body.token)
        return {"status": "registered"}
    except Exception:
        return {"status": "ok"}


@app.delete("/api/push-token", tags=["push"])
async def unregister_push_token(body: PushTokenBody) -> dict:
    """In-app off switch: deletes this device's token so the server stops
    sending it pushes. Deliberately unauthenticated like registration —
    beta testers are guests, and a token is only ever its own device's."""
    try:
        from services import push

        await push.remove_token(body.token)
        return {"status": "removed"}
    except Exception:
        return {"status": "ok"}


# ── Beta feedback (Settings → suggestion box) ────────────────────────────────
# Deliberately unauthenticated: beta testers are guests (accounts are off),
# so there is no token to check. Messages are length-capped and stored in the
# beta_feedback table — nothing is emailed on submit. The morning digest
# batches every not-yet-emailed item into one email (see
# services/email_service.py::send_digest), and the admin portal Feedback page
# lists items individually for review. If the table does not exist yet (the
# one-time CREATE TABLE in schema.sql has not been run on this database),
# the endpoint returns 503 so the app shows an error instead of a fake
# success — it never silently drops a submission.
class FeedbackBody(BaseModel):
    message: str
    platform: str | None = None
    app_version: str | None = None


@app.post("/api/feedback", tags=["feedback"])
async def submit_feedback(body: FeedbackBody) -> dict:
    from fastapi import HTTPException

    message = (body.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Feedback message is empty")
    if len(message) > 2000:
        raise HTTPException(status_code=400, detail="Feedback is too long (max 2000 characters)")

    try:
        from services import db

        await db.insert_feedback(message, body.platform, body.app_version)
    except Exception as exc:
        log.warning("Beta feedback store failed: %s", exc)
        raise HTTPException(status_code=503, detail="Could not save feedback — please try again later")
    return {"status": "stored"}


# ── Anonymous usage metrics ───────────────────────────────────────────────────
# Two unauthenticated endpoints (beta testers are guests, same reasoning as
# feedback). Privacy: /install carries no identifier at all and only bumps
# an aggregate daily counter; /device carries a random UUID generated on
# the device and upserts one row (first_seen kept, last_seen refreshed).
# Neither endpoint accepts or stores IPs, names, emails, or accounts.
# The general rate-limit middleware already covers both paths. On DB
# failure both return 503 (not a fake ok) so the app leaves its flags
# unset and retries on the next launch — same contract as feedback.
_METRIC_PLATFORMS = ("ios", "android", "web")
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)


class MetricsInstallBody(BaseModel):
    platform: str
    app_version: str | None = None


class MetricsDeviceBody(BaseModel):
    device_id: str
    platform: str
    app_version: str | None = None


@app.post("/api/metrics/install", tags=["metrics"])
async def record_install_metric(body: MetricsInstallBody) -> dict:
    from fastapi import HTTPException

    if body.platform not in _METRIC_PLATFORMS:
        return {"status": "ignored"}
    try:
        from services import db

        await db.record_install(body.platform)
    except Exception as exc:
        log.warning("Metrics install store failed: %s", exc)
        raise HTTPException(status_code=503, detail="Could not record install")
    return {"status": "ok"}


@app.post("/api/metrics/device", tags=["metrics"])
async def record_device_metric(body: MetricsDeviceBody) -> dict:
    from fastapi import HTTPException

    if body.platform not in _METRIC_PLATFORMS:
        return {"status": "ignored"}
    device_id = (body.device_id or "").lower()
    if not _UUID_RE.fullmatch(device_id):
        return {"status": "ignored"}
    try:
        from services import db

        await db.record_device(device_id, body.platform, (body.app_version or "unknown")[:32])
    except Exception as exc:
        log.warning("Metrics device store failed: %s", exc)
        raise HTTPException(status_code=503, detail="Could not record device")
    return {"status": "ok"}


# ── Admin portal (Jinja2, HTTP Basic Auth) ────────────────────────────────────
app.include_router(admin_portal.router)         # already prefixed /admin


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8080"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
