from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import secrets

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.api_token import ApiToken
from app.models.reseller import Reseller
from app.schemas.api_tokens import ApiTokenOut

TOKEN_PREFIX = "ghb_"


def generate_api_token() -> str:
    return f"{TOKEN_PREFIX}{secrets.token_urlsafe(32)}"


def hash_api_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def token_display_prefix(token: str) -> str:
    return token[:16]


def api_token_to_out(token: ApiToken) -> ApiTokenOut:
    return ApiTokenOut(
        id=token.id,
        reseller_id=token.reseller_id,
        name=token.name,
        token_prefix=token.token_prefix,
        scopes=[str(s) for s in (token.scopes or [])],
        created_at=token.created_at,
        updated_at=token.updated_at,
        expires_at=token.expires_at,
        last_used_at=token.last_used_at,
        revoked_at=token.revoked_at,
    )


async def create_api_token(
    db: AsyncSession,
    *,
    reseller: Reseller,
    name: str,
    created_by: Reseller | None = None,
    expires_at: datetime | None = None,
) -> tuple[ApiToken, str]:
    raw_token = generate_api_token()
    record = ApiToken(
        reseller_id=reseller.id,
        created_by_reseller_id=created_by.id if created_by else reseller.id,
        name=(name or "bot").strip()[:128] or "bot",
        token_prefix=token_display_prefix(raw_token),
        token_hash=hash_api_token(raw_token),
        scopes=[(reseller.role or "reseller").strip().lower()],
        expires_at=expires_at,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record, raw_token


async def find_active_api_token(db: AsyncSession, raw_token: str) -> ApiToken | None:
    token_hash = hash_api_token(raw_token)
    q = await db.execute(select(ApiToken).where(ApiToken.token_hash == token_hash))
    record = q.scalar_one_or_none()
    if not record or record.revoked_at is not None:
        return None
    if record.expires_at is not None:
        expires_at = record.expires_at
        now = datetime.now(expires_at.tzinfo) if expires_at.tzinfo else datetime.utcnow()
        if expires_at < now:
            return None
    return record


async def touch_api_token(db: AsyncSession, token: ApiToken) -> None:
    token.last_used_at = datetime.now(timezone.utc)
    await db.commit()
