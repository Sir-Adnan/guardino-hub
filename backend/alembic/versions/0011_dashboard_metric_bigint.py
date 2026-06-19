"""use bigint for dashboard sold metrics

Revision ID: 0011_dashboard_metric_bigint
Revises: 0010_add_reseller_two_factor
Create Date: 2026-06-19
"""

from alembic import op
import sqlalchemy as sa


revision = "0011_dashboard_metric_bigint"
down_revision = "0010_add_reseller_two_factor"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {c["name"] for c in inspector.get_columns(table_name)}


def _column_type_name(table_name: str, column_name: str) -> str:
    inspector = sa.inspect(op.get_bind())
    for column in inspector.get_columns(table_name):
        if column["name"] == column_name:
            return str(column["type"]).lower()
    return ""


def upgrade():
    if not _has_column("dashboard_daily_metrics", "sold_gb_total"):
        return
    if "bigint" in _column_type_name("dashboard_daily_metrics", "sold_gb_total"):
        return
    op.alter_column(
        "dashboard_daily_metrics",
        "sold_gb_total",
        existing_type=sa.Integer(),
        type_=sa.BigInteger(),
        existing_nullable=False,
        postgresql_using="sold_gb_total::bigint",
    )


def downgrade():
    if not _has_column("dashboard_daily_metrics", "sold_gb_total"):
        return
    if "integer" in _column_type_name("dashboard_daily_metrics", "sold_gb_total"):
        return
    op.alter_column(
        "dashboard_daily_metrics",
        "sold_gb_total",
        existing_type=sa.BigInteger(),
        type_=sa.Integer(),
        existing_nullable=False,
        postgresql_using="LEAST(sold_gb_total, 2147483647)::integer",
    )
