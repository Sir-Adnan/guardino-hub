"""add reseller two factor authentication fields

Revision ID: 0010_add_reseller_two_factor
Revises: 0009_add_node_soft_delete
Create Date: 2026-06-18
"""

from alembic import op
import sqlalchemy as sa


revision = "0010_add_reseller_two_factor"
down_revision = "0009_add_node_soft_delete"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {c["name"] for c in inspector.get_columns(table_name)}


def upgrade():
    if not _has_column("resellers", "two_factor_enabled"):
        op.add_column(
            "resellers",
            sa.Column("two_factor_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
    if not _has_column("resellers", "two_factor_secret_enc"):
        op.add_column("resellers", sa.Column("two_factor_secret_enc", sa.Text(), nullable=True))
    if not _has_column("resellers", "two_factor_recovery_hashes"):
        op.add_column(
            "resellers",
            sa.Column("two_factor_recovery_hashes", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        )
    if not _has_column("resellers", "two_factor_confirmed_at"):
        op.add_column("resellers", sa.Column("two_factor_confirmed_at", sa.DateTime(timezone=True), nullable=True))
    if not _has_column("resellers", "two_factor_last_used_at"):
        op.add_column("resellers", sa.Column("two_factor_last_used_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    for column_name in (
        "two_factor_last_used_at",
        "two_factor_confirmed_at",
        "two_factor_recovery_hashes",
        "two_factor_secret_enc",
        "two_factor_enabled",
    ):
        if _has_column("resellers", column_name):
            op.drop_column("resellers", column_name)
