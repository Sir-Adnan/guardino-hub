from __future__ import annotations
import os
import time
import uuid
import redis
from contextlib import contextmanager
from app.core.config import settings

def _client() -> redis.Redis:
    return redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)

# Atomic compare-and-delete so we never delete a lock that has expired and been
# re-acquired by another worker between our GET and DELETE.
_RELEASE_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
"""


@contextmanager
def redis_lock(key: str, ttl_seconds: int = 120):
    """Simple distributed lock using SET NX EX with atomic release."""
    token = str(uuid.uuid4())
    c = _client()
    acquired = bool(c.set(key, token, nx=True, ex=ttl_seconds))
    try:
        yield acquired
    finally:
        # Only the holder releases, and only via an atomic compare-and-delete.
        if acquired:
            try:
                c.eval(_RELEASE_SCRIPT, 1, key, token)
            except Exception:
                pass
