from __future__ import annotations

from app.models.node import Node, PanelType
from app.services.adapters.marzban import MarzbanAdapter
from app.services.adapters.pasarguard import PasarguardAdapter
from app.services.adapters.wg_dashboard import WGDashboardAdapter


def get_adapter(node: Node):
    creds = node.credentials or {}
    verify_ssl = bool(creds.get("verify_ssl", True))
    timeout = float(creds.get("timeout", 20.0))

    if node.panel_type == PanelType.marzban:
        return MarzbanAdapter(node.base_url, creds, verify_ssl=verify_ssl, timeout=timeout)
    if node.panel_type == PanelType.pasarguard:
        return PasarguardAdapter(node.base_url, creds, verify_ssl=verify_ssl, timeout=timeout)
    if node.panel_type == PanelType.wg_dashboard:
        return WGDashboardAdapter(node.base_url, creds, verify_ssl=verify_ssl, timeout=timeout)

    raise ValueError(f"Unsupported panel_type: {node.panel_type}")
