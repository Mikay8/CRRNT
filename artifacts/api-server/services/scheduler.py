"""APScheduler wrapper — runs ingestion daily at 8 AM Eastern,
cleanup daily at 3 AM Eastern.
"""
from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from services import ingestion

log = logging.getLogger("crrnt.scheduler")

_scheduler: AsyncIOScheduler | None = None


async def _daily_ingest() -> None:
    await ingestion.run_ingestion()


async def _daily_cleanup() -> None:
    await ingestion.run_cleanup()


def start() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = AsyncIOScheduler(timezone="America/New_York")
    _scheduler.add_job(
        _daily_ingest,
        CronTrigger(hour=8, minute=0),
        id="daily_ingestion",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    _scheduler.add_job(
        _daily_cleanup,
        CronTrigger(hour=3, minute=0),
        id="daily_cleanup",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    _scheduler.start()
    log.info("Scheduler started — ingestion 08:00 ET, cleanup 03:00 ET")


def shutdown() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
