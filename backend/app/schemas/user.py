from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class UserOut(BaseModel):
    id: int
    label: str
    total_gb: int
    used_bytes: int
    expire_at: datetime
    status: str

class UsersPage(BaseModel):
    items: list[UserOut]
    total: int
