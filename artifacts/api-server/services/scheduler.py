"""APScheduler wrapper that runs ingestion daily at 8 AM Eastern."""
from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from services import ingestion

log = logging.getLogger("marktr.scheduler")

_scheduler: AsyncIOScheduler | None = None


def start() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = AsyncIOScheduler(timezone="America/New_York")
    _scheduler.add_job(
        ingestion.run_ingestion,
        CronTrigger(hour=8, minute=0),
        id="daily_ingestion",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    _scheduler.start()
    log.info("Scheduler started — daily ingestion at 08:00 America/New_York")


def shutdown() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
