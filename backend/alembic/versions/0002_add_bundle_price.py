"""add bundle_price_per_gb to resellers

Revision ID: 0002_add_bundle_price
Revises: 0001_init_core
Create Date: 2026-02-21T22:57:19.305985Z
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_add_bundle_price"
down_revision = "0001_init_core"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("resellers", sa.Column("bundle_price_per_gb", sa.Integer(), nullable=True))

def downgrade():
    op.drop_column("resellers", "bundle_price_per_gb")
