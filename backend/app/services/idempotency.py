from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.order import Order

REQUEST_ID_HEADER = "Idempotency-Key"
_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")


def normalize_request_id(value: str | None) -> str | None:
    request_id = str(value or "").strip()
    if not request_id:
        return None
    if not _REQUEST_ID_RE.match(request_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="request_id must be 8-128 chars and may contain letters, numbers, dot, underscore, colon or dash.",
        )
    return request_id


def request_id_from(request: Request, payload: Any | None = None) -> str | None:
    header_value = request.headers.get(REQUEST_ID_HEADER)
    body_value = getattr(payload, "request_id", None) if payload is not None else None
    request_id = normalize_request_id(header_value or body_value)
    if not request_id and getattr(request.state, "auth_type", "") == "api_token":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Idempotency-Key or request_id is required for API-token financial operations.",
        )
    return request_id


async def find_order_by_request_id(
    db: AsyncSession,
    *,
    reseller_id: int,
    request_id: str,
) -> Order | None:
    q = await db.execute(
        select(Order).where(
            Order.reseller_id == reseller_id,
            Order.client_request_id == request_id,
        )
    )
    return q.scalar_one_or_none()
