"""APScheduler wrapper — ingestion and cleanup run daily at admin-configurable
times (app_settings.schedule_times, currently 06:00 / 03:00), taking effect
immediately via reschedule(). Also runs the Morning Edition push daily at
7:30 AM Eastern (fixed, not admin-configurable yet): if the admin moves
ingestion later than 7:30, the push simply covers whatever was inserted in
the last 12 hours that day. All three times are Eastern, not UTC.
"""
from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from services import ingestion, ingest_config

log = logging.getLogger("crrnt.scheduler")

# Every trigger below carries this explicitly. Do NOT rely on the scheduler's
# timezone: APScheduler only applies it to triggers given as strings, while
# a pre-built CronTrigger with no timezone falls back to the container's
# local zone — UTC on Railway. That silently ran ingestion at 2 AM ET and
# the Morning Edition push at 3:30 AM ET for months (2026-10-28).
_TZ = "America/New_York"

_scheduler: AsyncIOScheduler | None = None


async def _daily_ingest() -> None:
    params = await ingest_config.get_run_params()
    log.info("Scheduled ingestion starting with params: %s", params)
    await ingestion.run_ingestion(**params)


async def _daily_cleanup() -> None:
    await ingestion.run_cleanup()


async def _daily_digest_push() -> None:
    from services import notifications

    try:
        await notifications.send_morning_digest_push()
    except Exception as exc:
        log.warning("Morning digest push failed: %s", exc)


async def start() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = AsyncIOScheduler(timezone=_TZ)

    from services import app_settings
    times = await app_settings.get_schedule_times()
    ih, im = times["ingest_hour"], times["ingest_minute"]
    ch, cm = times["cleanup_hour"], times["cleanup_minute"]

    _scheduler.add_job(
        _daily_ingest,
        CronTrigger(hour=ih, minute=im, timezone=_TZ),
        id="daily_ingestion",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    _scheduler.add_job(
        _daily_cleanup,
        CronTrigger(hour=ch, minute=cm, timezone=_TZ),
        id="daily_cleanup",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    _scheduler.add_job(
        _daily_digest_push,
        CronTrigger(hour=7, minute=30, timezone=_TZ),
        id="daily_digest_push",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    _scheduler.start()
    log.info("Scheduler started — ingestion %02d:%02d ET, cleanup %02d:%02d ET, digest push 07:30 ET", ih, im, ch, cm)


def reschedule(ingest_hour: int, ingest_minute: int, cleanup_hour: int, cleanup_minute: int) -> None:
    """Reschedule both jobs immediately — called after admin saves new times."""
    if _scheduler is None:
        return
    _scheduler.reschedule_job(
        "daily_ingestion",
        trigger=CronTrigger(hour=ingest_hour, minute=ingest_minute, timezone=_TZ),
    )
    _scheduler.reschedule_job(
        "daily_cleanup",
        trigger=CronTrigger(hour=cleanup_hour, minute=cleanup_minute, timezone=_TZ),
    )
    log.info(
        "Schedule updated — ingestion %02d:%02d ET, cleanup %02d:%02d ET",
        ingest_hour, ingest_minute, cleanup_hour, cleanup_minute,
    )


def get_job_status() -> list[dict]:
    """next_run_time for each scheduled job, for the admin dashboard —
    lets us confirm a job is actually armed instead of finding out by a
    missed run."""
    if _scheduler is None:
        return []
    rows = []
    for job in _scheduler.get_jobs():
        next_run = job.next_run_time
        rows.append({
            "id": job.id,
            "next_run": next_run.isoformat() if next_run else None,
        })
    return rows


def shutdown() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
