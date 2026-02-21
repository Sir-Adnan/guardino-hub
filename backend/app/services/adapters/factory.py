from __future__ import annotations
from app.models.node import Node, PanelType
from app.services.adapters.marzban import MarzbanAdapter
from app.services.adapters.pasarguard import PasarguardAdapter
from app.services.adapters.wg_dashboard import WGDashboardAdapter

def get_adapter(node: Node):
    if node.panel_type == PanelType.marzban:
        return MarzbanAdapter(node.base_url, node.credentials)
    if node.panel_type == PanelType.pasarguard:
        return PasarguardAdapter(node.base_url, node.credentials)
    if node.panel_type == PanelType.wg_dashboard:
        return WGDashboardAdapter(node.base_url, node.credentials)
    raise ValueError(f"Unsupported panel_type: {node.panel_type}")
