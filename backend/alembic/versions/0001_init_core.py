"""init core tables

Revision ID: 0001_init_core
Revises: 
Create Date: 2026-02-21T22:19:13.213354Z
"""

from alembic import op
import sqlalchemy as sa

revision = "0001_init_core"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        "resellers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("resellers.id"), nullable=True),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("status", sa.Enum("active","locked","suspended", name="resellerstatus"), nullable=False, server_default="active"),
        sa.Column("balance", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("price_per_gb", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("price_per_day", sa.Integer(), nullable=True),
        sa.Column("can_create_subreseller", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_resellers_username", "resellers", ["username"], unique=True)

    op.create_table(
        "nodes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("panel_type", sa.Enum("marzban","pasarguard","wg_dashboard", name="paneltype"), nullable=False),
        sa.Column("base_url", sa.String(length=255), nullable=False),
        sa.Column("credentials", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("tags", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_visible_in_sub", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )

    op.create_table(
        "node_allocations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("reseller_id", sa.Integer(), sa.ForeignKey("resellers.id"), nullable=False),
        sa.Column("node_id", sa.Integer(), sa.ForeignKey("nodes.id"), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("default_for_reseller", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("price_per_gb_override", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("reseller_id", "node_id", name="uq_allocation_reseller_node"),
    )
    op.create_index("ix_node_allocations_reseller_id", "node_allocations", ["reseller_id"])
    op.create_index("ix_node_allocations_node_id", "node_allocations", ["node_id"])

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_reseller_id", sa.Integer(), sa.ForeignKey("resellers.id"), nullable=False),
        sa.Column("label", sa.String(length=128), nullable=False),
        sa.Column("total_gb", sa.Integer(), nullable=False),
        sa.Column("used_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("expire_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.Enum("active","disabled","deleted", name="userstatus"), nullable=False, server_default="active"),
        sa.Column("master_sub_token", sa.String(length=64), nullable=False),
        sa.Column("node_selection_mode", sa.Enum("manual","group", name="nodeselectionmode"), nullable=False, server_default="manual"),
        sa.Column("node_group", sa.String(length=64), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_users_owner_reseller_id", "users", ["owner_reseller_id"])
    op.create_index("ix_users_master_sub_token", "users", ["master_sub_token"], unique=True)

    op.create_table(
        "subaccounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("node_id", sa.Integer(), sa.ForeignKey("nodes.id"), nullable=False),
        sa.Column("remote_identifier", sa.String(length=128), nullable=False),
        sa.Column("panel_sub_url_cached", sa.String(length=512), nullable=True),
        sa.Column("panel_sub_url_cached_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("used_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_subaccounts_user_id", "subaccounts", ["user_id"])
    op.create_index("ix_subaccounts_node_id", "subaccounts", ["node_id"])

    op.create_table(
        "orders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("reseller_id", sa.Integer(), sa.ForeignKey("resellers.id"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("type", sa.Enum("create","add_traffic","extend","change_nodes","refund","delete", name="ordertype"), nullable=False),
        sa.Column("status", sa.Enum("pending","completed","failed","rolled_back", name="orderstatus"), nullable=False, server_default="pending"),
        sa.Column("purchased_gb", sa.Integer(), nullable=True),
        sa.Column("price_per_gb_snapshot", sa.Integer(), nullable=True),
        sa.Column("created_at_override", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_orders_reseller_id", "orders", ["reseller_id"])
    op.create_index("ix_orders_user_id", "orders", ["user_id"])

    op.create_table(
        "ledger_transactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("reseller_id", sa.Integer(), sa.ForeignKey("resellers.id"), nullable=False),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("orders.id"), nullable=True),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("reason", sa.String(length=255), nullable=False),
        sa.Column("balance_after", sa.BigInteger(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_ledger_transactions_reseller_id", "ledger_transactions", ["reseller_id"])
    op.create_index("ix_ledger_transactions_order_id", "ledger_transactions", ["order_id"])

def downgrade():
    op.drop_table("ledger_transactions")
    op.drop_table("orders")
    op.drop_table("subaccounts")
    op.drop_table("users")
    op.drop_table("node_allocations")
    op.drop_table("nodes")
    op.drop_index("ix_resellers_username", table_name="resellers")
    op.drop_table("resellers")
