from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

class ExtendRequest(BaseModel):
    request_id: Optional[str] = Field(default=None, min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    days: int = Field(gt=0, le=3650)

class DecreaseTimeRequest(BaseModel):
    request_id: Optional[str] = Field(default=None, min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    days: int = Field(gt=0, le=3650)

class AddTrafficRequest(BaseModel):
    request_id: Optional[str] = Field(default=None, min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    add_gb: int = Field(gt=0, le=100000)

class RenewRequest(BaseModel):
    request_id: Optional[str] = Field(default=None, min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    days: int = Field(gt=0, le=3650)
    total_gb: int = Field(gt=0, le=100000)
    pricing_mode: str = Field(default="bundle", pattern="^(per_node|bundle)$")

class ChangeNodesRequest(BaseModel):
    request_id: Optional[str] = Field(default=None, min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    add_node_ids: Optional[List[int]] = None
    remove_node_ids: Optional[List[int]] = None

class RefundAction(str):
    decrease = "decrease"
    delete = "delete"

class RefundRequest(BaseModel):
    request_id: Optional[str] = Field(default=None, min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    action: str = Field(pattern="^(decrease|delete)$")
    decrease_gb: Optional[int] = Field(default=None, gt=0, le=100000)


class SetStatusRequest(BaseModel):
    status: str = Field(pattern="^(active|disabled)$")

class OpResult(BaseModel):
    ok: bool
    order_id: Optional[int] = None
    request_id: Optional[str] = None
    charged_amount: int = 0
    refunded_amount: int = 0
    new_balance: int
    user_id: int
    detail: Optional[str] = None
