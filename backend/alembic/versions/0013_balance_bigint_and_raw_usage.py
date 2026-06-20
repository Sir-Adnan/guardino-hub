"""widen reseller balance to bigint and track raw subaccount usage

Revision ID: 0013_balance_bigint_and_raw_usage
Revises: 0012_ledger_request_id
Create Date: 2026-06-20

Both operations are idempotent and safe to re-run:
  * resellers.balance INTEGER -> BIGINT (tiny table, instant rewrite) so
    high-value wallets cannot overflow int32.
  * subaccounts.last_raw_used (nullable BIGINT, no default) records the last
    raw usage value read from the upstream panel so the usage sync can detect
    counter resets/rollovers instead of letting the user total go backwards.
    Adding a nullable column without a default is a metadata-only change in
    PostgreSQL, so it stays fast even on large subaccount tables.
"""

from alembic import op
import sqlalchemy as sa


revision = "0013_balance_bigint_and_raw_usage"
down_revision = "0012_ledger_request_id"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {c["name"] for c in inspector.get_columns(table_name)}


def _column_type_name(table_name: str, column_name: str) -> str:
    inspector = sa.inspect(op.get_bind())
    for column in inspector.get_columns(table_name):
        if column["name"] == column_name:
            return str(column["type"]).lower()
    return ""


def upgrade():
    if _has_column("resellers", "balance") and "bigint" not in _column_type_name("resellers", "balance"):
        op.alter_column(
            "resellers",
            "balance",
            existing_type=sa.Integer(),
            type_=sa.BigInteger(),
            existing_nullable=False,
            postgresql_using="balance::bigint",
        )

    if not _has_column("subaccounts", "last_raw_used"):
        op.add_column(
            "subaccounts",
            sa.Column("last_raw_used", sa.BigInteger(), nullable=True),
        )


def downgrade():
    if _has_column("subaccounts", "last_raw_used"):
        op.drop_column("subaccounts", "last_raw_used")

    if _has_column("resellers", "balance") and "integer" not in _column_type_name("resellers", "balance"):
        op.alter_column(
            "resellers",
            "balance",
            existing_type=sa.BigInteger(),
            type_=sa.Integer(),
            existing_nullable=False,
            postgresql_using="LEAST(balance, 2147483647)::integer",
        )
