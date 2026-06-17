"""add allocation credentials

Revision ID: 0007_add_allocation_credentials
Revises: 0006_add_order_client_request_id
Create Date: 2026-06-18
"""

from alembic import op
import sqlalchemy as sa


revision = "0007_add_allocation_credentials"
down_revision = "0006_add_order_client_request_id"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "node_allocations",
        sa.Column("credential_mode", sa.String(length=16), nullable=False, server_default="shared"),
    )
    op.add_column(
        "node_allocations",
        sa.Column("credentials", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
    )
    op.add_column("subaccounts", sa.Column("allocation_id", sa.Integer(), nullable=True))
    op.create_index("ix_subaccounts_allocation_id", "subaccounts", ["allocation_id"])
    op.create_foreign_key(
        "fk_subaccounts_allocation_id_node_allocations",
        "subaccounts",
        "node_allocations",
        ["allocation_id"],
        ["id"],
    )
    op.execute(
        """
        UPDATE subaccounts AS s
        SET allocation_id = a.id
        FROM users AS u, node_allocations AS a
        WHERE s.user_id = u.id
          AND a.reseller_id = u.owner_reseller_id
          AND a.node_id = s.node_id
          AND s.allocation_id IS NULL
        """
    )


def downgrade():
    op.drop_constraint("fk_subaccounts_allocation_id_node_allocations", "subaccounts", type_="foreignkey")
    op.drop_index("ix_subaccounts_allocation_id", table_name="subaccounts")
    op.drop_column("subaccounts", "allocation_id")
    op.drop_column("node_allocations", "credentials")
    op.drop_column("node_allocations", "credential_mode")
