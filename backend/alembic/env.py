from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context
import os
from app.core.config import settings
from app.core.db import Base
from app import models  # noqa: F401  (import models for metadata)

config = context.config
fileConfig(config.config_file_name)

target_metadata = Base.metadata

def get_url():
    # Alembic uses sync driver; convert asyncpg URL to psycopg URL for migrations
    url = settings.DATABASE_URL
    url = url.replace("postgresql+asyncpg://", "postgresql+psycopg://")
    return url

def run_migrations_offline():
    context.configure(
        url=get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online():
    connectable = engine_from_config(
        {"sqlalchemy.url": get_url()},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
