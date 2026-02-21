from sqlalchemy import String, Integer, Boolean, Enum, JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base
from app.models.common import TimestampMixin
import enum

class PanelType(str, enum.Enum):
    marzban = "marzban"
    pasarguard = "pasarguard"
    wg_dashboard = "wg_dashboard"

class Node(Base, TimestampMixin):
    __tablename__ = "nodes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    panel_type: Mapped[PanelType] = mapped_column(Enum(PanelType), nullable=False)
    base_url: Mapped[str] = mapped_column(String(255), nullable=False)

    credentials: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)  # encrypt at rest in production
    tags: Mapped[list] = mapped_column(JSON, default=list, nullable=False)

    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_visible_in_sub: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
