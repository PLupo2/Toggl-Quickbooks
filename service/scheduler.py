"""Scheduled sync -- built per R4, deliberately NOT started at launch.
Replaces Menu.gs's setupAutomatedTriggers/automatedSync (a daily 6am
ScriptApp trigger) with the APScheduler equivalent, plus an hourly
connection-status cache refresh. Not imported/started anywhere in app.py --
enabling this later is a one-line change (call start_scheduler() from
app.py's lifespan) plus picking a genuinely low-contention hour, since the
sync job shares Toggl's 240/hr organizational bucket with every other tool
hitting the same workspace.
"""
import logging

from apscheduler.schedulers.background import BackgroundScheduler

logger = logging.getLogger(__name__)

_scheduler = None


def _scheduled_sync_job():
    import sync_engine
    try:
        sync_engine.start_async_sync_job()
    except Exception:
        logger.exception("Scheduled sync failed to start")


def _scheduled_connection_refresh():
    from routes import _recompute_connection_status
    try:
        _recompute_connection_status()
    except Exception:
        logger.exception("Scheduled connection-status refresh failed")


def create_scheduler(sync_hour=6):
    """Builds (but does not start) a BackgroundScheduler with the daily
    sync + hourly connection-status refresh jobs registered."""
    sched = BackgroundScheduler(timezone="America/New_York")
    sched.add_job(_scheduled_sync_job, "cron", hour=sync_hour, minute=0, id="daily_sync", replace_existing=True)
    sched.add_job(_scheduled_connection_refresh, "interval", hours=1, id="connection_status_refresh", replace_existing=True)
    return sched


def start_scheduler(sync_hour=6):
    """Call explicitly to enable (e.g. from app.py's lifespan, gated on a
    settings flag) -- not invoked anywhere by default."""
    global _scheduler
    if _scheduler is not None:
        return _scheduler
    _scheduler = create_scheduler(sync_hour)
    _scheduler.start()
    logger.info("Scheduler started: daily sync at %02d:00 America/New_York, hourly connection-status refresh", sync_hour)
    return _scheduler


def stop_scheduler():
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
