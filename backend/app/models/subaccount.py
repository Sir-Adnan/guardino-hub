from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.common import TimestampMixin


class SubAccount(Base, TimestampMixin):
    __tablename__ = "subaccounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    node_id: Mapped[int] = mapped_column(Integer, ForeignKey("nodes.id"), index=True, nullable=False)
    allocation_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("node_allocations.id"), index=True, nullable=True)

    remote_identifier: Mapped[str] = mapped_column(String(128), nullable=False)

    panel_sub_url_cached: Mapped[str | None] = mapped_column(String(512), nullable=True)
    panel_sub_url_cached_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    used_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    # Last raw usage value read from the upstream panel. Used by the usage sync
    # to detect counter resets/rollovers so the cumulative `used_bytes` never
    # goes backwards. NULL means "not yet observed" (legacy rows).
    last_raw_used: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
