from pydantic import BaseModel


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

    nodes_allowed: int

    orders_total: int
    orders_30d: int
    spent_30d: int


class AdminStats(BaseModel):
    resellers_total: int
    users_total: int
    nodes_total: int
    orders_total: int
    ledger_entries_total: int

    ledger_net_30d: int
    price_per_gb_avg: int | None = None
