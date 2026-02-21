from sqlalchemy import String, Integer, BigInteger, ForeignKey, Enum, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.db import Base
from app.models.common import TimestampMixin
import enum

class ResellerStatus(str, enum.Enum):
    active = "active"
    locked = "locked"
    suspended = "suspended"

class Reseller(Base, TimestampMixin):
    __tablename__ = "resellers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    parent_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("resellers.id"), nullable=True)

    username: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    status: Mapped[ResellerStatus] = mapped_column(Enum(ResellerStatus), default=ResellerStatus.active, nullable=False)

    balance: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)  # store in smallest unit (e.g. toman*1), or plain integer

    price_per_gb: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    price_per_day: Mapped[int | None] = mapped_column(Integer, nullable=True)  # optional; null => 0

    can_create_subreseller: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    parent = relationship("Reseller", remote_side=[id])
