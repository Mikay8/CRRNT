"""CRRNT FastAPI server.

Architecture v2:
  - All data stored in Supabase PostgreSQL (no KV / Replit DB)
  - Supabase Auth for user auth (JWT validated per-request)
  - RevenueCat webhooks for subscription management
  - APScheduler for daily ingestion (08:00 ET) and cleanup (03:00 ET)
  - Jinja2 admin portal at /admin (HTTP Basic Auth)
"""
from __future__ import annotations

import logging
import os
import time
from collections import defaultdict, deque
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
from routes import subscriptions as subscriptions_routes
from routes import admin_portal
from services import log_buffer, scheduler, metrics

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("crrnt")
log.addHandler(log_buffer.handler)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    log.info("CRRNT API v2 starting up")

    # Validate required Supabase env vars (warn but don't crash so healthz works)
    if not os.environ.get("SUPABASE_URL"):
        log.warning("SUPABASE_URL is not set — database calls will fail")
    if not os.environ.get("SUPABASE_SERVICE_KEY"):
        log.warning("SUPABASE_SERVICE_KEY is not set — database calls will fail")

    scheduler.start()

    try:
        yield
    finally:
        scheduler.shutdown()
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


_rate_windows: dict[str, deque] = defaultdict(deque)
_RATE_WINDOW = 60.0
_GENERAL_LIMIT = 60
_EXPENSIVE_LIMIT = 10
_EXPENSIVE_SEGMENTS = ("/audio", "/personalized-audio")


@app.middleware("http")
async def _rate_limit_middleware(request: Request, call_next):
    path = request.url.path
    if path.startswith("/admin") or "/health" in path:
        return await call_next(request)

    client_ip = (request.client.host if request.client else "unknown")
    now = time.monotonic()
    is_expensive = any(seg in path for seg in _EXPENSIVE_SEGMENTS)
    limit = _EXPENSIVE_LIMIT if is_expensive else _GENERAL_LIMIT
    key = f"{client_ip}:{'exp' if is_expensive else 'gen'}"

    bucket = _rate_windows[key]
    cutoff = now - _RATE_WINDOW
    while bucket and bucket[0] < cutoff:
        bucket.popleft()

    if len(bucket) >= limit:
        return JSONResponse(
            status_code=429,
            content={"detail": "Rate limit exceeded. Try again in 60 seconds."},
            headers={"Retry-After": "60"},
        )

    bucket.append(now)
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
app.include_router(subscriptions_routes.router) # already prefixed /api/subscriptions

# ── Legacy push token endpoint (backward compat with old app installs) ────────
from fastapi import Request
from pydantic import BaseModel

class PushTokenBody(BaseModel):
    token: str

@app.post("/api/push-token", tags=["push"])
async def register_push_token(body: PushTokenBody) -> dict:
    try:
        from services import push
        push.add_token(body.token)
        return {"status": "registered"}
    except Exception:
        return {"status": "ok"}

# ── Admin portal (Jinja2, HTTP Basic Auth) ────────────────────────────────────
app.include_router(admin_portal.router)         # already prefixed /admin


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8080"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
