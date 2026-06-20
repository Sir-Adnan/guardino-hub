from __future__ import annotations

import hashlib
import logging

from fastapi import HTTPException, Request, status
from redis.asyncio import Redis

from app.core.config import settings

logger = logging.getLogger(__name__)

_INCREMENT_SCRIPT = """
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return {current, redis.call('TTL', KEYS[1])}
"""


def _client_ip(request: Request) -> str:
    real_ip = str(request.headers.get("x-real-ip") or "").strip()
    if real_ip:
        return real_ip[:128]
    forwarded = str(request.headers.get("x-forwarded-for") or "").split(",", 1)[0].strip()
    if forwarded:
        return forwarded[:128]
    return str(request.client.host if request.client else "unknown")[:128]


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _identity_key(action: str, identity: str) -> str:
    return f"guardino:auth-limit:{action}:identity:{_digest(identity.strip().lower())}"


def _ip_key(action: str, request: Request) -> str:
    return f"guardino:auth-limit:{action}:ip:{_digest(_client_ip(request))}"


async def enforce_auth_rate_limit(request: Request, *, action: str, identity: str) -> None:
    window = max(60, int(getattr(settings, "AUTH_RATE_LIMIT_WINDOW_SECONDS", 300) or 300))
    identity_limit = max(3, int(getattr(settings, "AUTH_RATE_LIMIT_ATTEMPTS", 10) or 10))
    ip_limit = max(identity_limit, int(getattr(settings, "AUTH_RATE_LIMIT_IP_ATTEMPTS", 100) or 100))
    client = Redis.from_url(settings.REDIS_URL, decode_responses=True)
    try:
        identity_result = await client.eval(
            _INCREMENT_SCRIPT,
            1,
            _identity_key(action, identity),
            window,
        )
        ip_result = await client.eval(
            _INCREMENT_SCRIPT,
            1,
            _ip_key(action, request),
            window,
        )
        identity_count, identity_ttl = int(identity_result[0]), int(identity_result[1])
        ip_count, ip_ttl = int(ip_result[0]), int(ip_result[1])
        if identity_count > identity_limit or ip_count > ip_limit:
            retry_after = max(1, identity_ttl if identity_count > identity_limit else ip_ttl)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many authentication attempts. Try again later.",
                headers={"Retry-After": str(retry_after)},
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("auth rate limit unavailable action=%s err=%s", action, str(exc)[:160])
    finally:
        await client.aclose()


async def clear_auth_identity_limit(*, action: str, identity: str) -> None:
    client = Redis.from_url(settings.REDIS_URL, decode_responses=True)
    try:
        await client.delete(_identity_key(action, identity))
    except Exception:
        pass
    finally:
        await client.aclose()
