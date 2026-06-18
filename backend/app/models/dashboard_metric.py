from __future__ import annotations

from datetime import date

from sqlalchemy import BigInteger, Date, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.common import TimestampMixin


class DashboardDailyMetric(Base, TimestampMixin):
    __tablename__ = "dashboard_daily_metrics"
    __table_args__ = (
        UniqueConstraint("day", "reseller_id", name="uq_dashboard_daily_metrics_day_reseller"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    day: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    reseller_id: Mapped[int] = mapped_column(Integer, ForeignKey("resellers.id"), nullable=False, index=True)

    users_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    users_active: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    users_disabled: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    users_expired: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    users_limited: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    users_on_hold: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    users_deleted: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    sold_gb_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    used_bytes_total: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
