"""fix resellers schema (role + enum/status + defaults)

Revision ID: 0003_fix_resellers_schema
Revises: 0002_add_bundle_price
Create Date: 2026-02-25

This migration fixes early schema mismatches between SQLAlchemy models and
initial Alembic revisions.
"""

from alembic import op
import sqlalchemy as sa


revision = "0003_fix_resellers_schema"
down_revision = "0002_add_bundle_price"
branch_labels = None
depends_on = None


def _is_postgres() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def upgrade():
    # 1) Add role column (used for RBAC). Default is reseller.
    with op.batch_alter_table("resellers") as batch_op:
        batch_op.add_column(
            sa.Column(
                "role",
                sa.String(length=16),
                nullable=False,
                server_default=sa.text("'reseller'"),
            )
        )

    # 2) Ensure numeric defaults / non-nullability.
    # price_per_day was nullable in 0001 but model expects non-null with default 0.
    op.execute("UPDATE resellers SET price_per_day = 0 WHERE price_per_day IS NULL")

    # bundle_price_per_gb was added as nullable in 0002; model expects non-null with default 0.
    op.execute(
        "UPDATE resellers SET bundle_price_per_gb = 0 WHERE bundle_price_per_gb IS NULL"
    )

    with op.batch_alter_table("resellers") as batch_op:
        batch_op.alter_column(
            "price_per_day",
            existing_type=sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        )
        batch_op.alter_column(
            "bundle_price_per_gb",
            existing_type=sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        )

    # 3) Fix reseller status enum values.
    # Old DB enum values were: active, locked, suspended
    # New canonical values are: active, disabled, deleted
    if _is_postgres():
        # Temporarily convert to text to allow value mapping.
        op.execute("ALTER TABLE resellers ALTER COLUMN status DROP DEFAULT")
        op.execute("ALTER TABLE resellers ALTER COLUMN status TYPE TEXT USING status::text")

        # Map legacy values to the new set.
        op.execute(
            "UPDATE resellers SET status='disabled' WHERE status IN ('locked','suspended')"
        )
        # Safety: if anything else sneaks in, coerce to 'disabled'.
        op.execute(
            "UPDATE resellers SET status='disabled' WHERE status NOT IN ('active','disabled','deleted')"
        )

        # Create a new enum, migrate, then replace the old one.
        op.execute(
            "DO $$ BEGIN "
            "IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resellerstatus_new') THEN "
            "CREATE TYPE resellerstatus_new AS ENUM ('active','disabled','deleted'); "
            "END IF; "
            "END$$;"
        )
        op.execute(
            "ALTER TABLE resellers ALTER COLUMN status "
            "TYPE resellerstatus_new USING status::resellerstatus_new"
        )
        op.execute("DROP TYPE resellerstatus")
        op.execute("ALTER TYPE resellerstatus_new RENAME TO resellerstatus")
        op.execute("ALTER TABLE resellers ALTER COLUMN status SET DEFAULT 'active'")
    else:
        # For non-PostgreSQL DBs, best effort: keep as-is.
        # (The project ships with PostgreSQL by default.)
        pass


def downgrade():
    # NOTE: Downgrade is best-effort.
    # We revert to the legacy enum values and drop the role column.
    if _is_postgres():
        op.execute("ALTER TABLE resellers ALTER COLUMN status DROP DEFAULT")
        op.execute("ALTER TABLE resellers ALTER COLUMN status TYPE TEXT USING status::text")

        # Map back: disabled -> locked, deleted -> suspended
        op.execute("UPDATE resellers SET status='locked' WHERE status='disabled'")
        op.execute("UPDATE resellers SET status='suspended' WHERE status='deleted'")

        op.execute(
            "DO $$ BEGIN "
            "IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resellerstatus_old') THEN "
            "CREATE TYPE resellerstatus_old AS ENUM ('active','locked','suspended'); "
            "END IF; "
            "END$$;"
        )
        op.execute(
            "ALTER TABLE resellers ALTER COLUMN status "
            "TYPE resellerstatus_old USING status::resellerstatus_old"
        )
        op.execute("DROP TYPE resellerstatus")
        op.execute("ALTER TYPE resellerstatus_old RENAME TO resellerstatus")
        op.execute("ALTER TABLE resellers ALTER COLUMN status SET DEFAULT 'active'")

    with op.batch_alter_table("resellers") as batch_op:
        batch_op.drop_column("role")
        batch_op.alter_column(
            "bundle_price_per_gb",
            existing_type=sa.Integer(),
            nullable=True,
            server_default=None,
        )
        batch_op.alter_column(
            "price_per_day",
            existing_type=sa.Integer(),
            nullable=True,
            server_default=None,
        )
