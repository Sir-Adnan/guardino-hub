from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class ApiTokenCreateRequest(BaseModel):
    name: str = Field(default="bot", min_length=1, max_length=128)
    expires_at: Optional[datetime] = None


class ApiTokenOut(BaseModel):
    id: int
    reseller_id: int
    name: str
    token_prefix: str
    scopes: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    expires_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None


class ApiTokenCreated(ApiTokenOut):
    token: str


class ApiTokenList(BaseModel):
    items: list[ApiTokenOut]
    total: int
