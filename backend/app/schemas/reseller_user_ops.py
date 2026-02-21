from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

class CreateUserRequest(BaseModel):
    label: str = Field(min_length=1, max_length=128)
    username: str | None = Field(default=None, description="Optional username for remote panels")
    randomize_username: bool = Field(default=False, description="If true, username is auto-generated")

    duration_preset: str | None = Field(default=None, description="One of: 7d, 1m, 3m, 6m, 1y")
    total_gb: int = Field(gt=0, le=100000)
    days: int

    pricing_mode: str = Field(default="per_node", pattern="^(per_node|bundle)$")
 = Field(gt=0, le=3650)

    # one of:
    node_ids: Optional[List[int]] = None
    node_group: Optional[str] = None

class CreateUserResponse(BaseModel):
    user_id: int
    master_sub_token: str
    charged_amount: int
    nodes_provisioned: List[int]

class PriceQuoteResponse(BaseModel):
    total_amount: int
    per_node_amount: dict[int, int]
    time_amount: int