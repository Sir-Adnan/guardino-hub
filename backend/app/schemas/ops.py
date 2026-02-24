from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

class ExtendRequest(BaseModel):
    days: int = Field(gt=0, le=3650)

class AddTrafficRequest(BaseModel):
    add_gb: int = Field(gt=0, le=100000)

class ChangeNodesRequest(BaseModel):
    add_node_ids: Optional[List[int]] = None
    remove_node_ids: Optional[List[int]] = None

class RefundAction(str):
    decrease = "decrease"
    delete = "delete"

class RefundRequest(BaseModel):
    action: str = Field(pattern="^(decrease|delete)$")
    decrease_gb: Optional[int] = Field(default=None, gt=0, le=100000)


class SetStatusRequest(BaseModel):
    status: str = Field(pattern="^(active|disabled)$")

class OpResult(BaseModel):
    ok: bool
    charged_amount: int = 0
    refunded_amount: int = 0
    new_balance: int
    user_id: int
    detail: Optional[str] = None
