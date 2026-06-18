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


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {c["name"] for c in inspector.get_columns(table_name)}


def _has_index(table_name: str, index_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return index_name in {i["name"] for i in inspector.get_indexes(table_name)}


def _has_fk(table_name: str, fk_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return fk_name in {fk.get("name") for fk in inspector.get_foreign_keys(table_name)}


def upgrade():
    if not _has_column("node_allocations", "credential_mode"):
        op.add_column(
            "node_allocations",
            sa.Column("credential_mode", sa.String(length=16), nullable=False, server_default="shared"),
        )
    if not _has_column("node_allocations", "credentials"):
        op.add_column(
            "node_allocations",
            sa.Column("credentials", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        )
    if not _has_column("subaccounts", "allocation_id"):
        op.add_column("subaccounts", sa.Column("allocation_id", sa.Integer(), nullable=True))
    if not _has_index("subaccounts", "ix_subaccounts_allocation_id"):
        op.create_index("ix_subaccounts_allocation_id", "subaccounts", ["allocation_id"])
    if not _has_fk("subaccounts", "fk_subaccounts_allocation_id_node_allocations"):
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
    if _has_fk("subaccounts", "fk_subaccounts_allocation_id_node_allocations"):
        op.drop_constraint("fk_subaccounts_allocation_id_node_allocations", "subaccounts", type_="foreignkey")
    if _has_index("subaccounts", "ix_subaccounts_allocation_id"):
        op.drop_index("ix_subaccounts_allocation_id", table_name="subaccounts")
    if _has_column("subaccounts", "allocation_id"):
        op.drop_column("subaccounts", "allocation_id")
    if _has_column("node_allocations", "credentials"):
        op.drop_column("node_allocations", "credentials")
    if _has_column("node_allocations", "credential_mode"):
        op.drop_column("node_allocations", "credential_mode")
