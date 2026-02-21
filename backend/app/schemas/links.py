from pydantic import BaseModel
from typing import Optional

class NodeLink(BaseModel):
    node_id: int
    direct_url: Optional[str] = None
    status: str  # ok / missing / error
    detail: Optional[str] = None

class UserLinksResponse(BaseModel):
    user_id: int
    master_link: str
    node_links: list[NodeLink]
