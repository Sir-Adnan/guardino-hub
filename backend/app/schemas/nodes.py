from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class AllowedNodeOut(BaseModel):
    id: int
    name: str
    public_code: str
    panel_type: str
    tags: list[str] = Field(default_factory=list)
    is_visible_in_sub: bool
    default_for_reseller: bool
    price_per_gb_override: Optional[int] = None
    last_sync_at: Optional[str] = None


class AllowedNodeList(BaseModel):
    items: list[AllowedNodeOut]
