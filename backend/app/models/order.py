from sqlalchemy import Integer, ForeignKey, Enum, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime
from app.core.db import Base
from app.models.common import TimestampMixin
import enum

class OrderType(str, enum.Enum):
    create = "create"
    add_traffic = "add_traffic"
    extend = "extend"
    change_nodes = "change_nodes"
    refund = "refund"
    delete = "delete"

class OrderStatus(str, enum.Enum):
    pending = "pending"
    completed = "completed"
    failed = "failed"
    rolled_back = "rolled_back"

class Order(Base, TimestampMixin):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reseller_id: Mapped[int] = mapped_column(Integer, ForeignKey("resellers.id"), index=True, nullable=False)
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), index=True, nullable=True)

    type: Mapped[OrderType] = mapped_column(Enum(OrderType), nullable=False)
    status: Mapped[OrderStatus] = mapped_column(Enum(OrderStatus), default=OrderStatus.pending, nullable=False)

    purchased_gb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    price_per_gb_snapshot: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at_override: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # optional
