"""add order client request id

Revision ID: 0006_add_order_client_request_id
Revises: 0005_add_api_tokens
Create Date: 2026-06-18
"""

from alembic import op
import sqlalchemy as sa


revision = "0006_add_order_client_request_id"
down_revision = "0005_add_api_tokens"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("orders", sa.Column("client_request_id", sa.String(length=128), nullable=True))
    op.create_unique_constraint(
        "uq_orders_reseller_client_request_id",
        "orders",
        ["reseller_id", "client_request_id"],
    )


def downgrade():
    op.drop_constraint("uq_orders_reseller_client_request_id", "orders", type_="unique")
    op.drop_column("orders", "client_request_id")
