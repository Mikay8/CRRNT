"""Marktr FastAPI server.

Serves enriched daily news, stock price history, and an investment
simulator. Uses Replit DB as a simple key-value cache and APScheduler
for daily ingestion at 8 AM.
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()  # loads .env file when running locally; no-op on Replit

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes import admin, health, news, stocks
from services import cache, ingestion, log_buffer, scheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("marktr")
log.addHandler(log_buffer.handler)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    log.info("Marktr API starting up")
    cache.init()

    # Start the daily 8 AM ingestion job.
    scheduler.start()

    try:
        yield
    finally:
        scheduler.shutdown()
        log.info("Marktr API shutting down")


app = FastAPI(
    title="Marktr API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# Mount under /api so requests come through the workspace proxy at /api/...
app.include_router(health.router, prefix="/api")
app.include_router(news.router, prefix="/api")
app.include_router(stocks.router, prefix="/api")
app.include_router(admin.router, prefix="/api")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8080"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
