from pydantic import BaseModel, Field
from typing import Optional, List

class CreateResellerRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6, max_length=128)
    parent_id: Optional[int] = None
    price_per_gb: int
    bundle_price_per_gb: Optional[int] = 0
    price_per_day: Optional[int] = 0
    can_create_subreseller: bool = True

class ResellerOut(BaseModel):
    id: int
    parent_id: Optional[int]
    username: str
    role: str
    status: str
    balance: int
    price_per_gb: int
    bundle_price_per_gb: Optional[int]
    price_per_day: Optional[int]
    can_create_subreseller: Optional[bool] = None


class UpdateResellerRequest(BaseModel):
    parent_id: Optional[int] = None
    password: Optional[str] = Field(default=None, min_length=6, max_length=128)
    price_per_gb: Optional[int] = None
    bundle_price_per_gb: Optional[int] = None
    price_per_day: Optional[int] = None
    can_create_subreseller: Optional[bool] = None


class SetResellerStatusRequest(BaseModel):
    status: str = Field(min_length=3, max_length=16)  # active|disabled

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

class UpdateNodeRequest(BaseModel):
    name: Optional[str] = None
    panel_type: Optional[str] = None  # marzban / pasarguard / wg_dashboard
    base_url: Optional[str] = None
    credentials: Optional[dict] = None
    tags: Optional[List[str]] = None
    is_enabled: Optional[bool] = None
    is_visible_in_sub: Optional[bool] = None

class NodeOut(BaseModel):
    id: int
    name: str
    panel_type: str
    base_url: str
    credentials: dict = {}
    tags: List[str]
    is_enabled: bool
    is_visible_in_sub: bool

class NodeList(BaseModel):
    items: List[NodeOut]
    total: int

class CreateAllocationRequest(BaseModel):
    reseller_id: int
    node_id: int
    enabled: bool = True
    default_for_reseller: bool = False
    price_per_gb_override: Optional[int] = None

class UpdateAllocationRequest(BaseModel):
    enabled: Optional[bool] = None
    default_for_reseller: Optional[bool] = None
    price_per_gb_override: Optional[int] = None

class AllocationOut(BaseModel):
    id: int
    reseller_id: int
    node_id: int
    enabled: bool
    default_for_reseller: bool
    price_per_gb_override: Optional[int]

class AllocationList(BaseModel):
    items: List[AllocationOut]
    total: int

class ResellerList(BaseModel):
    items: List[ResellerOut]
    total: int
