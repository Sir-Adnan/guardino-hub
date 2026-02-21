from __future__ import annotations
import os
import time
import uuid
import redis
from contextlib import contextmanager
from app.core.config import settings

def _client() -> redis.Redis:
    return redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)

@contextmanager
def redis_lock(key: str, ttl_seconds: int = 120):
    """Simple distributed lock using SET NX EX."""
    token = str(uuid.uuid4())
    c = _client()
    acquired = c.set(key, token, nx=True, ex=ttl_seconds)
    try:
        yield bool(acquired)
    finally:
        # Best-effort safe release: only delete if token matches
        try:
            val = c.get(key)
            if val == token:
                c.delete(key)
        except Exception:
            pass
