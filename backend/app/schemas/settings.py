from __future__ import annotations

from pydantic import BaseModel, Field


class UserDefaults(BaseModel):
    default_pricing_mode: str = Field(default="bundle", pattern="^(bundle|per_node)$")
    default_node_mode: str = Field(default="all", pattern="^(all|manual|group)$")
    default_node_ids: list[int] = Field(default_factory=list)
    default_node_group: str = ""
    label_prefix: str = ""
    label_suffix: str = ""
    username_prefix: str = ""
    username_suffix: str = ""


class UserDefaultsEnvelope(BaseModel):
    global_defaults: UserDefaults
    reseller_defaults: UserDefaults
    effective: UserDefaults


class ResellerUserPolicy(BaseModel):
    enabled: bool = False
    allow_custom_days: bool = True
    allow_custom_traffic: bool = True
    allow_no_expire: bool = False
    min_days: int = 1
    max_days: int = 3650
    allowed_duration_presets: list[str] = Field(default_factory=lambda: ["7d", "1m", "3m", "6m", "1y"])
    allowed_traffic_gb: list[int] = Field(default_factory=lambda: [20, 30, 50, 70, 100, 150, 200])
