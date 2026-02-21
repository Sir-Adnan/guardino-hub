from sqlalchemy import Integer, ForeignKey, String, BigInteger, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime
from app.core.db import Base
from app.models.common import TimestampMixin

class SubAccount(Base, TimestampMixin):
    __tablename__ = "subaccounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    node_id: Mapped[int] = mapped_column(Integer, ForeignKey("nodes.id"), index=True, nullable=False)

    remote_identifier: Mapped[str] = mapped_column(String(128), nullable=False)  # username/uuid/peer id in panel
    panel_sub_url_cached: Mapped[str | None] = mapped_column(String(512), nullable=True)
    panel_sub_url_cached_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    used_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
