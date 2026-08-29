"""APScheduler wrapper — runs ingestion daily at 6 AM Eastern,
cleanup daily at 3 AM Eastern. Both times are admin-configurable
(app_settings.schedule_times) and take effect immediately via reschedule().
"""
from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from services import ingestion, ingest_config

log = logging.getLogger("crrnt.scheduler")

_scheduler: AsyncIOScheduler | None = None


async def _daily_ingest() -> None:
    params = await ingest_config.get_run_params()
    log.info("Scheduled ingestion starting with params: %s", params)
    await ingestion.run_ingestion(**params)


async def _daily_cleanup() -> None:
    await ingestion.run_cleanup()


async def start() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = AsyncIOScheduler(timezone="America/New_York")

    from services import app_settings
    times = await app_settings.get_schedule_times()
    ih, im = times["ingest_hour"], times["ingest_minute"]
    ch, cm = times["cleanup_hour"], times["cleanup_minute"]

    _scheduler.add_job(
        _daily_ingest,
        CronTrigger(hour=ih, minute=im),
        id="daily_ingestion",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    _scheduler.add_job(
        _daily_cleanup,
        CronTrigger(hour=ch, minute=cm),
        id="daily_cleanup",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    _scheduler.start()
    log.info("Scheduler started — ingestion %02d:%02d ET, cleanup %02d:%02d ET", ih, im, ch, cm)


def reschedule(ingest_hour: int, ingest_minute: int, cleanup_hour: int, cleanup_minute: int) -> None:
    """Reschedule both jobs immediately — called after admin saves new times."""
    if _scheduler is None:
        return
    _scheduler.reschedule_job(
        "daily_ingestion",
        trigger=CronTrigger(hour=ingest_hour, minute=ingest_minute),
    )
    _scheduler.reschedule_job(
        "daily_cleanup",
        trigger=CronTrigger(hour=cleanup_hour, minute=cleanup_minute),
    )
    log.info(
        "Schedule updated — ingestion %02d:%02d ET, cleanup %02d:%02d ET",
        ingest_hour, ingest_minute, cleanup_hour, cleanup_minute,
    )


def shutdown() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
