from __future__ import annotations
from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "guardino_hub",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.tasks.expiry"],
)

celery_app.conf.timezone = "UTC"
celery_app.conf.beat_schedule = {
    "expire_users_every_minute": {
        "task": "app.tasks.expiry.expire_due_users",
        "schedule": 60.0,
    }
}
