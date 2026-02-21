from pydantic import BaseModel, Field
from typing import Optional, List

class CreateResellerRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6, max_length=128)
    parent_id: Optional[int] = None
    price_per_gb: int
    bundle_price_per_gb: Optional[int] = 0
    bundle_price_per_gb: Optional[int] = None
    price_per_day: Optional[int] = None
    can_create_subreseller: bool = True

class ResellerOut(BaseModel):
    id: int
    parent_id: Optional[int]
    username: str
    status: str
    balance: int
    price_per_gb: int
    bundle_price_per_gb: Optional[int]
    price_per_day: Optional[int]

class CreditRequest(BaseModel):
    amount: int = Field(gt=0)
    reason: str = Field(default="manual_credit")

class CreateNodeRequest(BaseModel):
    name: str
    panel_type: str  # marzban / pasarguard / wg_dashboard
    base_url: str
    credentials: dict = {}
    tags: List[str] = []
    is_enabled: bool = True
    is_visible_in_sub: bool = True

class NodeOut(BaseModel):
    id: int
    name: str
    panel_type: str
    base_url: str
    tags: List[str]
    is_enabled: bool
    is_visible_in_sub: bool

class CreateAllocationRequest(BaseModel):
    reseller_id: int
    node_id: int
    enabled: bool = True
    default_for_reseller: bool = False
    price_per_gb_override: Optional[int] = None

class AllocationOut(BaseModel):
    id: int
    reseller_id: int
    node_id: int
    enabled: bool
    default_for_reseller: bool
    price_per_gb_override: Optional[int]
