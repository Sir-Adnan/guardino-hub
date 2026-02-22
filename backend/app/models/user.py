from sqlalchemy import Integer, String, ForeignKey, DateTime, Enum, BigInteger, JSON
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime
from app.core.db import Base
from app.models.common import TimestampMixin
import enum

class UserStatus(str, enum.Enum):
    active = "active"
    disabled = "disabled"
    deleted = "deleted"

class NodeSelectionMode(str, enum.Enum):
    manual = "manual"
    group = "group"

class GuardinoUser(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_reseller_id: Mapped[int] = mapped_column(Integer, ForeignKey("resellers.id"), index=True, nullable=False)

    label: Mapped[str] = mapped_column(String(128), nullable=False)
    total_gb: Mapped[int] = mapped_column(Integer, nullable=False)
    used_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)

    expire_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[UserStatus] = mapped_column(Enum(UserStatus), default=UserStatus.active, nullable=False)

    master_sub_token: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)

    node_selection_mode: Mapped[NodeSelectionMode] = mapped_column(Enum(NodeSelectionMode), default=NodeSelectionMode.manual, nullable=False)
    node_group: Mapped[str | None] = mapped_column(String(64), nullable=True)  # group name/tag

    meta: Mapped[dict] = mapped_column(\"metadata\", JSON, default=dict, nullable=False)
