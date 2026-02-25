"""add app_settings table for UI defaults

Revision ID: 0004_add_app_settings
Revises: 0003_fix_resellers_schema
Create Date: 2026-02-25
"""

from alembic import op
import sqlalchemy as sa


revision = "0004_add_app_settings"
down_revision = "0003_fix_resellers_schema"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("value", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade():
    op.drop_table("app_settings")
