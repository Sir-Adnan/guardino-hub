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
