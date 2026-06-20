from pydantic import BaseModel, Field
from typing import Optional, List

from app.schemas.settings import ResellerUserPolicy

class CreateResellerRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=128)
    parent_id: Optional[int] = None
    price_per_gb: int
    bundle_price_per_gb: Optional[int] = 0
    price_per_day: Optional[int] = 0
    can_create_subreseller: bool = True
    user_policy: Optional[ResellerUserPolicy] = None

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
    user_policy: Optional[ResellerUserPolicy] = None


class UpdateResellerRequest(BaseModel):
    parent_id: Optional[int] = None
    password: Optional[str] = Field(default=None, min_length=8, max_length=128)
    price_per_gb: Optional[int] = None
    bundle_price_per_gb: Optional[int] = None
    price_per_day: Optional[int] = None
    can_create_subreseller: Optional[bool] = None
    user_policy: Optional[ResellerUserPolicy] = None


class SetResellerStatusRequest(BaseModel):
    status: str = Field(min_length=3, max_length=16)  # active|disabled

class CreditRequest(BaseModel):
    amount: int
    reason: str = Field(default="manual_credit")
    request_id: Optional[str] = Field(default=None, min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")


class CreditResponse(BaseModel):
    ok: bool
    balance: int
    transaction_id: int
    request_id: Optional[str] = None
    detail: Optional[str] = None


class DeleteResellerRequest(BaseModel):
    confirm: bool = False
    user_action: str = Field(default="keep", pattern="^(keep|disable|transfer)$")
    transfer_to_reseller_id: Optional[int] = None


class DeleteResellerPreview(BaseModel):
    reseller_id: int
    username: str
    role: str
    status: str
    balance: int
    users_total: int
    users_active: int
    users_disabled: int
    users_deleted: int
    active_orders: int = 0
    ledger_entries: int = 0
    allocations_total: int = 0
    api_tokens_active: int = 0
    requires_confirm: bool
    warnings: List[str] = Field(default_factory=list)

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
    is_deleted: bool = False
    last_sync_at: Optional[str] = None

class NodeList(BaseModel):
    items: List[NodeOut]
    total: int

class CreateAllocationRequest(BaseModel):
    reseller_id: int
    node_id: int
    enabled: bool = True
    default_for_reseller: bool = False
    price_per_gb_override: Optional[int] = None
    credential_mode: str = Field(default="shared", pattern="^(shared|dedicated)$")
    credentials: dict = Field(default_factory=dict)

class UpdateAllocationRequest(BaseModel):
    enabled: Optional[bool] = None
    default_for_reseller: Optional[bool] = None
    price_per_gb_override: Optional[int] = None
    credential_mode: Optional[str] = Field(default=None, pattern="^(shared|dedicated)$")
    credentials: Optional[dict] = None

class AllocationOut(BaseModel):
    id: int
    reseller_id: int
    node_id: int
    enabled: bool
    default_for_reseller: bool
    price_per_gb_override: Optional[int]
    credential_mode: str = "shared"
    credentials: dict = Field(default_factory=dict)

class AllocationList(BaseModel):
    items: List[AllocationOut]
    total: int


class AllocationNodeSummary(BaseModel):
    id: int
    name: str
    panel_type: str
    is_enabled: bool


class GroupedAllocationItem(BaseModel):
    id: int
    reseller_id: int
    node_id: int
    node_name: str
    panel_type: str
    node_is_enabled: bool
    enabled: bool
    default_for_reseller: bool
    price_per_gb_override: Optional[int]
    credential_mode: str = "shared"
    credentials: dict = Field(default_factory=dict)


class ResellerAllocationsGroup(BaseModel):
    reseller_id: int
    reseller_name: str
    reseller_role: str
    reseller_status: str
    allocations: List[GroupedAllocationItem]
    nodes: List[AllocationNodeSummary]
    active_panels_count: int


class ResellerAllocationsGroupedList(BaseModel):
    items: List[ResellerAllocationsGroup]
    total: int

class ResellerList(BaseModel):
    items: List[ResellerOut]
    total: int


class ImportRemoteUsersRequest(BaseModel):
    dry_run: bool = True
    limit: int = Field(default=1000, ge=1, le=5000)
    offset: int = Field(default=0, ge=0)
    max_pages: int = Field(default=200, ge=1, le=1000)
    all_pages: bool = True
    skip_existing: bool = True
    remote_admin: Optional[str] = Field(default=None, max_length=128)


class ImportRemoteUserItem(BaseModel):
    username: str
    remote_identifier: str
    total_gb: int
    used_bytes: int
    expire_at: Optional[str] = None
    status: str
    action: str
    detail: Optional[str] = None


class ImportRemoteUsersResponse(BaseModel):
    dry_run: bool
    allocation_id: int
    reseller_id: int
    node_id: int
    scanned: int
    imported: int
    skipped_existing: int
    errors: int
    total_remote: Optional[int] = None
    items: List[ImportRemoteUserItem]
