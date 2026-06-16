from __future__ import annotations

from pydantic import BaseModel, Field, field_validator, model_validator


ALLOWED_DURATION_PRESETS = {"7d", "1m", "3m", "6m", "1y", "unlimited"}
DEFAULT_DURATION_PRESETS = ["7d", "1m", "3m", "6m", "1y"]
DEFAULT_TRAFFIC_GB = [20, 30, 50, 70, 100, 150, 200]


class UserDefaults(BaseModel):
    default_pricing_mode: str = Field(default="per_node", pattern="^(bundle|per_node)$")
    default_node_mode: str = Field(default="manual", pattern="^(all|manual|group)$")
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
    allow_user_delete: bool = False
    allow_reset_usage: bool = False
    restrict_edit_to_renewal_only: bool = False
    renewal_policy: str = Field(default="add_time_and_volume", pattern="^(reset_time_and_volume|add_time_and_volume|reset_time_carry_volume|reset_volume_carry_time)$")
    min_days: int = Field(default=1, ge=1, le=36500)
    max_days: int = Field(default=3650, ge=1, le=36500)
    delete_refund_window_days: int = Field(default=10, ge=0, le=36500)
    delete_expired_used_gb_limit: float = Field(default=1.0, ge=0, le=100000)
    allowed_duration_presets: list[str] = Field(default_factory=lambda: list(DEFAULT_DURATION_PRESETS))
    allowed_traffic_gb: list[int] = Field(default_factory=lambda: list(DEFAULT_TRAFFIC_GB))

    @field_validator("allowed_duration_presets", mode="before")
    @classmethod
    def clean_duration_presets(cls, value):
        if not isinstance(value, list):
            return list(DEFAULT_DURATION_PRESETS)
        out: list[str] = []
        seen: set[str] = set()
        for item in value:
            preset = str(item or "").strip().lower()
            if preset not in ALLOWED_DURATION_PRESETS or preset in seen:
                continue
            out.append(preset)
            seen.add(preset)
        return out or list(DEFAULT_DURATION_PRESETS)

    @field_validator("allowed_traffic_gb", mode="before")
    @classmethod
    def clean_traffic_gb(cls, value):
        if not isinstance(value, list):
            return list(DEFAULT_TRAFFIC_GB)
        out: list[int] = []
        seen: set[int] = set()
        for item in value:
            try:
                gb = int(item)
            except Exception:
                continue
            if gb <= 0 or gb > 100000 or gb in seen:
                continue
            out.append(gb)
            seen.add(gb)
        return sorted(out) or list(DEFAULT_TRAFFIC_GB)

    @model_validator(mode="after")
    def normalize_policy_shape(self):
        if self.max_days < self.min_days:
            self.max_days = self.min_days
        if not self.allow_no_expire:
            self.allowed_duration_presets = [p for p in self.allowed_duration_presets if p != "unlimited"]
            if not self.allowed_duration_presets:
                self.allowed_duration_presets = list(DEFAULT_DURATION_PRESETS)
        elif "unlimited" not in self.allowed_duration_presets:
            self.allowed_duration_presets = [*self.allowed_duration_presets, "unlimited"]
        return self
