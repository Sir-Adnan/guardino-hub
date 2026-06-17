from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_reseller
from app.core.db import get_db
from app.models.node import Node
from app.models.node_allocation import NodeAllocation
from app.schemas.catalog import (
    CatalogDurationPreset,
    CatalogNode,
    CatalogPricing,
    CatalogTrafficOption,
    ResellerCatalog,
)
from app.schemas.settings import ResellerUserPolicy, UserDefaults
from app.services.reseller_user_policy import get_effective_user_policy
from app.services.user_defaults import get_effective_user_defaults

router = APIRouter()

_PRESET_DAYS = {
    "7d": 7,
    "1m": 31,
    "3m": 90,
    "6m": 180,
    "1y": 365,
    "unlimited": None,
}

_PRESET_LABELS = {
    "7d": "7 days",
    "1m": "1 month",
    "3m": "3 months",
    "6m": "6 months",
    "1y": "1 year",
    "unlimited": "Unlimited",
}


def _available_pricing_modes(bundle_price_per_gb: int) -> list[str]:
    modes = ["per_node"]
    if int(bundle_price_per_gb or 0) > 0:
        modes.append("bundle")
    return modes


@router.get("", response_model=ResellerCatalog)
async def get_catalog(
    db: AsyncSession = Depends(get_db),
    reseller=Depends(require_reseller),
):
    policy = ResellerUserPolicy(**await get_effective_user_policy(db, reseller.id))
    defaults = UserDefaults(**await get_effective_user_defaults(db, reseller.id))

    q = await db.execute(
        select(Node, NodeAllocation)
        .join(NodeAllocation, NodeAllocation.node_id == Node.id)
        .where(
            NodeAllocation.reseller_id == reseller.id,
            NodeAllocation.enabled == True,
            Node.is_enabled == True,
        )
        .order_by(NodeAllocation.default_for_reseller.desc(), Node.id.asc())
    )
    nodes = [
        CatalogNode(
            id=node.id,
            name=node.name,
            public_code=f"N-{node.id:04d}",
            panel_type=node.panel_type.value,
            tags=[str(t) for t in (node.tags or [])],
            is_visible_in_sub=bool(node.is_visible_in_sub),
            default_for_reseller=bool(allocation.default_for_reseller),
            price_per_gb=int(allocation.price_per_gb_override)
            if allocation.price_per_gb_override is not None
            else int(reseller.price_per_gb or 0),
            price_per_gb_override=allocation.price_per_gb_override,
        )
        for node, allocation in q.all()
    ]

    duration_presets = [
        CatalogDurationPreset(
            code=code,
            days=_PRESET_DAYS.get(code),
            label=_PRESET_LABELS.get(code, code),
        )
        for code in policy.allowed_duration_presets
        if code in _PRESET_DAYS
    ]
    traffic_options = [CatalogTrafficOption(gb=int(gb)) for gb in policy.allowed_traffic_gb]

    bundle_price = int(getattr(reseller, "bundle_price_per_gb", 0) or 0)
    return ResellerCatalog(
        reseller_id=reseller.id,
        username=reseller.username,
        role=(reseller.role or "reseller"),
        status=reseller.status.value,
        balance=int(reseller.balance or 0),
        pricing=CatalogPricing(
            price_per_gb=int(reseller.price_per_gb or 0),
            bundle_price_per_gb=bundle_price,
            price_per_day=int(reseller.price_per_day or 0),
            available_pricing_modes=_available_pricing_modes(bundle_price),
        ),
        policy=policy,
        defaults=defaults,
        duration_presets=duration_presets,
        traffic_options=traffic_options,
        nodes=nodes,
    )
