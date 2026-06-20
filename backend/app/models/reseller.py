from __future__ import annotations

import enum

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Enum, ForeignKey, Integer, JSON, String, Text
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
    two_factor_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    two_factor_secret_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    two_factor_recovery_hashes: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    two_factor_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    two_factor_last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    role: Mapped[str] = mapped_column(String(16), default="reseller", nullable=False)  # reseller|admin
    can_create_subreseller: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    status: Mapped[ResellerStatus] = mapped_column(Enum(ResellerStatus), default=ResellerStatus.active, nullable=False)

    # BigInteger so high-value (e.g. Rial-denominated) wallets cannot overflow int32.
    balance: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)

    # default pricing for this reseller
    price_per_gb: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    price_per_day: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # added in migration 0002
    bundle_price_per_gb: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
