from __future__ import annotations
from celery import Celery
from celery.signals import worker_ready
import logging
from app.core.config import settings

logger = logging.getLogger(__name__)

celery_app = Celery(
    "guardino_hub",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.tasks.expiry", "app.tasks.usage"],
)

celery_app.conf.timezone = "UTC"

usage_every = max(30, min(3600, int(getattr(settings, "USAGE_SYNC_SECONDS", 60) or 60)))
expiry_every = max(30, min(3600, int(getattr(settings, "EXPIRY_SYNC_SECONDS", 60) or 60)))

celery_app.conf.beat_schedule = {
    "expire_users_every_interval": {
        "task": "app.tasks.expiry.expire_due_users",
        "schedule": float(expiry_every),
    },
    "sync_usage_every_interval": {
        "task": "app.tasks.usage.sync_usage",
        "schedule": float(usage_every),
    },
}


@worker_ready.connect
def _kickoff_sync_tasks(sender=None, **kwargs):
    app = getattr(sender, "app", celery_app)
    for task_name in ("app.tasks.expiry.expire_due_users", "app.tasks.usage.sync_usage"):
        try:
            app.send_task(task_name)
        except Exception as e:
            logger.warning("celery startup task dispatch failed task=%s err=%s", task_name, str(e)[:220])
