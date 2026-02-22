from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.common import TimestampMixin


class UserStatus(str, enum.Enum):
    active = "active"
    disabled = "disabled"
    deleted = "deleted"


class NodeSelectionMode(str, enum.Enum):
    manual = "manual"  # selection stored in metadata.requested_node_ids
    group = "group"    # selection stored in node_group


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

    node_selection_mode: Mapped[NodeSelectionMode] = mapped_column(
        Enum(NodeSelectionMode), default=NodeSelectionMode.manual, nullable=False
    )
    node_group: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # NOTE: "metadata" is reserved in SQLAlchemy Declarative.
    # Keep DB column name "metadata" but expose it as "meta".
    meta: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)
