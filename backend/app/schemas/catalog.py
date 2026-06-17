from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.settings import ResellerUserPolicy, UserDefaults


class CatalogPricing(BaseModel):
    price_per_gb: int
    bundle_price_per_gb: int
    price_per_day: int
    available_pricing_modes: list[str] = Field(default_factory=list)


class CatalogDurationPreset(BaseModel):
    code: str
    days: int | None
    label: str


class CatalogTrafficOption(BaseModel):
    gb: int


class CatalogNode(BaseModel):
    id: int
    name: str
    public_code: str
    panel_type: str
    tags: list[str] = Field(default_factory=list)
    is_visible_in_sub: bool
    default_for_reseller: bool
    price_per_gb: int
    price_per_gb_override: int | None = None


class ResellerCatalog(BaseModel):
    reseller_id: int
    username: str
    role: str
    status: str
    balance: int
    pricing: CatalogPricing
    policy: ResellerUserPolicy
    defaults: UserDefaults
    duration_presets: list[CatalogDurationPreset]
    traffic_options: list[CatalogTrafficOption]
    nodes: list[CatalogNode]
