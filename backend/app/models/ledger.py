from sqlalchemy import Integer, ForeignKey, BigInteger, String, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime
from app.core.db import Base
from app.models.common import TimestampMixin

class LedgerTransaction(Base, TimestampMixin):
    __tablename__ = "ledger_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reseller_id: Mapped[int] = mapped_column(Integer, ForeignKey("resellers.id"), index=True, nullable=False)
    order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("orders.id"), index=True, nullable=True)

    amount: Mapped[int] = mapped_column(BigInteger, nullable=False)  # positive or negative
    reason: Mapped[str] = mapped_column(String(255), nullable=False)
    balance_after: Mapped[int] = mapped_column(BigInteger, nullable=False)

    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
