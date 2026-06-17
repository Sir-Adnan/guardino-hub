from pydantic import BaseModel, Field, field_validator, model_validator
from datetime import datetime
from typing import List, Optional

class CreateUserRequest(BaseModel):
    request_id: Optional[str] = Field(default=None, min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    label: str = Field(min_length=1, max_length=128)

    # Optional username for remote panels (Marzban/Pasarguard). WG may ignore.
    username: Optional[str] = None
    randomize_username: bool = Field(default=False, description="If true, username is auto-generated")
    create_status: str = Field(default="active", pattern="^(active|on_hold)$")

    # One of: 7d, 1m, 3m, 6m, 1y, unlimited
    duration_preset: Optional[str] = Field(default=None, pattern="^(7d|1m|3m|6m|1y|unlimited)$")

    total_gb: int = Field(gt=0, le=100000)
    days: int = Field(ge=0, le=36500)

    pricing_mode: str = Field(default="per_node", pattern="^(per_node|bundle)$")

    # Node selection (one of these)
    node_ids: Optional[List[int]] = None
    node_group: Optional[str] = Field(default=None, max_length=64)

    @field_validator("node_ids", mode="before")
    @classmethod
    def clean_node_ids(cls, value):
        if value in (None, ""):
            return None
        if not isinstance(value, list):
            return value
        out: list[int] = []
        seen: set[int] = set()
        for item in value:
            try:
                node_id = int(item)
            except Exception:
                continue
            if node_id <= 0 or node_id in seen:
                continue
            out.append(node_id)
            seen.add(node_id)
        return out or None

    @field_validator("node_group", mode="before")
    @classmethod
    def clean_node_group(cls, value):
        text = str(value or "").strip()
        return text or None

    @model_validator(mode="after")
    def validate_node_selection(self):
        if self.node_ids and self.node_group:
            raise ValueError("Use either node_ids or node_group, not both.")
        return self

class CreateUserResponse(BaseModel):
    user_id: int
    label: str
    order_id: Optional[int] = None
    request_id: Optional[str] = None
    master_sub_token: str
    subscription_url: Optional[str] = None
    expire_at: datetime
    charged_amount: int
    balance_after: int
    nodes_provisioned: List[int]

class PriceQuoteResponse(BaseModel):
    total_amount: int
    per_node_amount: dict[int, int]
    time_amount: int
