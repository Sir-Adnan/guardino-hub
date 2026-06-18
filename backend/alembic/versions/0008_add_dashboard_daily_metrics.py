"""add dashboard daily metrics

Revision ID: 0008_add_dashboard_daily_metrics
Revises: 0007_add_allocation_credentials
Create Date: 2026-06-18
"""

from alembic import op
import sqlalchemy as sa


revision = "0008_add_dashboard_daily_metrics"
down_revision = "0007_add_allocation_credentials"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def _has_index(table_name: str, index_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return index_name in {i["name"] for i in inspector.get_indexes(table_name)}


def upgrade():
    if not _has_table("dashboard_daily_metrics"):
        op.create_table(
            "dashboard_daily_metrics",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("day", sa.Date(), nullable=False),
            sa.Column("reseller_id", sa.Integer(), nullable=False),
            sa.Column("users_total", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("users_active", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("users_disabled", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("users_expired", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("users_limited", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("users_on_hold", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("users_deleted", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("sold_gb_total", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("used_bytes_total", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["reseller_id"], ["resellers.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("day", "reseller_id", name="uq_dashboard_daily_metrics_day_reseller"),
        )

    if not _has_index("dashboard_daily_metrics", "ix_dashboard_daily_metrics_day"):
        op.create_index("ix_dashboard_daily_metrics_day", "dashboard_daily_metrics", ["day"])
    if not _has_index("dashboard_daily_metrics", "ix_dashboard_daily_metrics_reseller_id"):
        op.create_index("ix_dashboard_daily_metrics_reseller_id", "dashboard_daily_metrics", ["reseller_id"])

    op.execute(
        """
        INSERT INTO dashboard_daily_metrics (
          day,
          reseller_id,
          users_total,
          users_active,
          users_disabled,
          users_expired,
          users_limited,
          users_on_hold,
          users_deleted,
          sold_gb_total,
          used_bytes_total,
          created_at,
          updated_at
        )
        SELECT
          CURRENT_DATE,
          owner_reseller_id,
          COUNT(*) FILTER (WHERE status <> 'deleted')::integer,
          COUNT(*) FILTER (WHERE status = 'active')::integer,
          COUNT(*) FILTER (WHERE status = 'disabled')::integer,
          COUNT(*) FILTER (WHERE status <> 'deleted' AND expire_at < NOW())::integer,
          COUNT(*) FILTER (
            WHERE status <> 'deleted'
              AND total_gb > 0
              AND used_bytes >= (total_gb::bigint * 1073741824)
          )::integer,
          COUNT(*) FILTER (
            WHERE status = 'active'
              AND COALESCE(metadata->>'create_status', '') = 'on_hold'
          )::integer,
          COUNT(*) FILTER (
            WHERE status = 'deleted'
              AND EXISTS (
                SELECT 1 FROM orders
                WHERE orders.user_id = users.id
                  AND orders.status = 'completed'
              )
          )::integer,
          COALESCE(SUM(total_gb) FILTER (
            WHERE status <> 'deleted'
               OR EXISTS (
                 SELECT 1 FROM orders
                 WHERE orders.user_id = users.id
                   AND orders.status = 'completed'
               )
          ), 0)::integer,
          COALESCE(SUM(used_bytes) FILTER (
            WHERE status <> 'deleted'
               OR EXISTS (
                 SELECT 1 FROM orders
                 WHERE orders.user_id = users.id
                   AND orders.status = 'completed'
               )
          ), 0)::bigint,
          NOW(),
          NOW()
        FROM users
        GROUP BY owner_reseller_id
        ON CONFLICT (day, reseller_id) DO NOTHING
        """
    )


def downgrade():
    if _has_table("dashboard_daily_metrics"):
        op.drop_table("dashboard_daily_metrics")
