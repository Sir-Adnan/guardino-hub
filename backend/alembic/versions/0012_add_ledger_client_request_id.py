"""add ledger client request id

Revision ID: 0012_ledger_request_id
Revises: 0011_dashboard_metric_bigint
Create Date: 2026-06-20
"""

from alembic import op
import sqlalchemy as sa


revision = "0012_ledger_request_id"
down_revision = "0011_dashboard_metric_bigint"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def _has_unique_constraint(table_name: str, constraint_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return constraint_name in {
        str(item.get("name") or "")
        for item in inspector.get_unique_constraints(table_name)
    }


def upgrade():
    if not _has_column("ledger_transactions", "client_request_id"):
        op.add_column(
            "ledger_transactions",
            sa.Column("client_request_id", sa.String(length=128), nullable=True),
        )
    if not _has_unique_constraint("ledger_transactions", "uq_ledger_reseller_client_request_id"):
        op.create_unique_constraint(
            "uq_ledger_reseller_client_request_id",
            "ledger_transactions",
            ["reseller_id", "client_request_id"],
        )


def downgrade():
    if _has_unique_constraint("ledger_transactions", "uq_ledger_reseller_client_request_id"):
        op.drop_constraint(
            "uq_ledger_reseller_client_request_id",
            "ledger_transactions",
            type_="unique",
        )
    if _has_column("ledger_transactions", "client_request_id"):
        op.drop_column("ledger_transactions", "client_request_id")
