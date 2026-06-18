"""add node soft delete flag

Revision ID: 0009_add_node_soft_delete
Revises: 0008_add_dashboard_daily_metrics
Create Date: 2026-06-18
"""

from alembic import op
import sqlalchemy as sa


revision = "0009_add_node_soft_delete"
down_revision = "0008_add_dashboard_daily_metrics"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {c["name"] for c in inspector.get_columns(table_name)}


def _has_index(table_name: str, index_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return index_name in {i["name"] for i in inspector.get_indexes(table_name)}


def upgrade():
    if not _has_column("nodes", "is_deleted"):
        op.add_column("nodes", sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()))
    if not _has_index("nodes", "ix_nodes_is_deleted"):
        op.create_index("ix_nodes_is_deleted", "nodes", ["is_deleted"])


def downgrade():
    if _has_index("nodes", "ix_nodes_is_deleted"):
        op.drop_index("ix_nodes_is_deleted", table_name="nodes")
    if _has_column("nodes", "is_deleted"):
        op.drop_column("nodes", "is_deleted")
