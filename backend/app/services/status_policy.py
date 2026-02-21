from __future__ import annotations
from enum import Enum
from typing import Optional
from app.models.node import PanelType
from app.services.adapters.base import PanelAdapter

class InternalStatus(str, Enum):
    active = "active"
    disabled = "disabled"
    limited = "limited"   # volume exhausted
    expired = "expired"   # time expired

def panel_status_for(panel: PanelType, status: InternalStatus) -> str:
    """Map internal status to panel-specific status values."""
    if panel == PanelType.wg_dashboard:
        # WGDashboard uses allow/restrict endpoints in adapter.set_status
        return "active" if status == InternalStatus.active else "limited"

    # Marzban/Pasarguard: keep subscription stable, so disable for both expired/limited
    if status == InternalStatus.active:
        return "active"
    return "disabled"

async def enforce_time_expiry(panel: PanelType, adapter: PanelAdapter, remote_identifier: str):
    """Enforce time expiry on remote panel.
    Policy:
      - WGDashboard: hard cut -> delete peer
      - Others: disable (no revoke_sub, no delete)
    """
    if panel == PanelType.wg_dashboard:
        await adapter.delete_user(remote_identifier)
        return
    await adapter.disable_user(remote_identifier)

async def enforce_volume_exhausted(panel: PanelType, adapter: PanelAdapter, remote_identifier: str):
    """Enforce volume exhausted on remote panel.
    Policy:
      - WGDashboard: restrict
      - Others: disable
    """
    if panel == PanelType.wg_dashboard:
        await adapter.set_status(remote_identifier, panel_status_for(panel, InternalStatus.limited))
        return
    await adapter.disable_user(remote_identifier)

async def enable_if_needed(panel: PanelType, adapter: PanelAdapter, remote_identifier: str):
    """Enable user on remote panel after extension/traffic increase."""
    if panel == PanelType.wg_dashboard:
        await adapter.set_status(remote_identifier, panel_status_for(panel, InternalStatus.active))
        return
    await adapter.enable_user(remote_identifier)
