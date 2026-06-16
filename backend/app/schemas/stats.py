from pydantic import BaseModel, Field


class DashboardSeriesPoint(BaseModel):
    date: str
    value: float


class ResellerStats(BaseModel):
    reseller_id: int
    balance: int
    status: str

    price_per_gb: int
    bundle_price_per_gb: int
    price_per_day: int

    users_total: int
    users_active: int
    users_disabled: int
    users_expired: int = 0
    users_limited: int = 0
    users_on_hold: int = 0
    used_bytes_total: int
    sold_gb_total: int

    nodes_allowed: int

    orders_total: int
    orders_30d: int
    spent_30d: int
    daily_sales: list[DashboardSeriesPoint] = Field(default_factory=list)
    daily_traffic_gb: list[DashboardSeriesPoint] = Field(default_factory=list)


class AdminStats(BaseModel):
    resellers_total: int
    users_total: int
    users_active: int = 0
    users_disabled: int = 0
    users_expired: int = 0
    users_limited: int = 0
    users_on_hold: int = 0
    nodes_total: int
    orders_total: int
    ledger_entries_total: int

    ledger_net_30d: int
    price_per_gb_avg: int | None = None
    used_bytes_total: int = 0
    sold_gb_total: int = 0
    daily_sales: list[DashboardSeriesPoint] = Field(default_factory=list)
    daily_traffic_gb: list[DashboardSeriesPoint] = Field(default_factory=list)
