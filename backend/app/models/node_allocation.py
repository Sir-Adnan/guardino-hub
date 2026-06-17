from sqlalchemy import Integer, ForeignKey, Boolean, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base
from app.models.common import TimestampMixin

class NodeAllocation(Base, TimestampMixin):
    __tablename__ = "node_allocations"
    __table_args__ = (
        UniqueConstraint("reseller_id", "node_id", name="uq_allocation_reseller_node"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reseller_id: Mapped[int] = mapped_column(Integer, ForeignKey("resellers.id"), nullable=False, index=True)
    node_id: Mapped[int] = mapped_column(Integer, ForeignKey("nodes.id"), nullable=False, index=True)

    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    default_for_reseller: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    price_per_gb_override: Mapped[int | None] = mapped_column(Integer, nullable=True)
    credential_mode: Mapped[str] = mapped_column(String(16), default="shared", nullable=False)
    credentials: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
