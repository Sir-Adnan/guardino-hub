"""add api tokens

Revision ID: 0005_add_api_tokens
Revises: 0004_add_app_settings
Create Date: 2026-06-18
"""

from alembic import op
import sqlalchemy as sa


revision = "0005_add_api_tokens"
down_revision = "0004_add_app_settings"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "api_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("reseller_id", sa.Integer(), sa.ForeignKey("resellers.id"), nullable=False),
        sa.Column("created_by_reseller_id", sa.Integer(), sa.ForeignKey("resellers.id"), nullable=True),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("token_prefix", sa.String(length=24), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("scopes", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_api_tokens_reseller_id", "api_tokens", ["reseller_id"])
    op.create_index("ix_api_tokens_token_prefix", "api_tokens", ["token_prefix"])
    op.create_index("ix_api_tokens_token_hash", "api_tokens", ["token_hash"], unique=True)


def downgrade():
    op.drop_index("ix_api_tokens_token_hash", table_name="api_tokens")
    op.drop_index("ix_api_tokens_token_prefix", table_name="api_tokens")
    op.drop_index("ix_api_tokens_reseller_id", table_name="api_tokens")
    op.drop_table("api_tokens")
