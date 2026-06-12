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
    show_guardino_master_sub: bool = False


class UserDefaultsEnvelope(BaseModel):
    global_defaults: UserDefaults
    reseller_defaults: UserDefaults
    effective: UserDefaults


class ResellerUserPolicy(BaseModel):
    enabled: bool = False
    allow_custom_days: bool = True
    allow_custom_traffic: bool = True
    allow_no_expire: bool = False
    allow_user_delete: bool = True
    allow_reset_usage: bool = True
    restrict_edit_to_renewal_only: bool = False
    renewal_policy: str = Field(default="add_time_and_volume", pattern="^(reset_time_and_volume|add_time_and_volume|reset_time_carry_volume|reset_volume_carry_time)$")
    min_days: int = 1
    max_days: int = 3650
    delete_refund_window_days: int = Field(default=10, ge=0, le=36500)
    delete_expired_used_gb_limit: float = Field(default=1.0, ge=0, le=100000)
    allowed_duration_presets: list[str] = Field(default_factory=lambda: ["7d", "1m", "3m", "6m", "1y"])
    allowed_traffic_gb: list[int] = Field(default_factory=lambda: [20, 30, 50, 70, 100, 150, 200])
