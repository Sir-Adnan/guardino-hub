from __future__ import annotations

import enum

from sqlalchemy import BigInteger, Boolean, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.common import TimestampMixin


class ResellerStatus(str, enum.Enum):
    active = "active"
    disabled = "disabled"
    deleted = "deleted"


class Reseller(Base, TimestampMixin):
    __tablename__ = "resellers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    parent_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("resellers.id"), nullable=True)

    username: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    role: Mapped[str] = mapped_column(String(16), default="reseller", nullable=False)  # reseller|admin
    can_create_subreseller: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    status: Mapped[ResellerStatus] = mapped_column(Enum(ResellerStatus), default=ResellerStatus.active, nullable=False)

    # NOTE: keep this aligned with DB (PostgreSQL BIGINT) to avoid overflow/mismatch.
    balance: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)

    # default pricing for this reseller
    price_per_gb: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    price_per_day: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # added in migration 0002
    bundle_price_per_gb: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
