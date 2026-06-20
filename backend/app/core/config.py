from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import AnyHttpUrl
from typing import List
import os

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=os.getenv("ENV_FILE", ".env"), extra="ignore")

    APP_NAME: str = "guardino-hub"
    ENV: str = "dev"

    SECRET_KEY: str = "please-change-me"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    API_TOKEN_TOUCH_INTERVAL_SECONDS: int = 300
    AUTH_RATE_LIMIT_WINDOW_SECONDS: int = 300
    AUTH_RATE_LIMIT_ATTEMPTS: int = 10
    AUTH_RATE_LIMIT_IP_ATTEMPTS: int = 100

    DATABASE_URL: str

    REDIS_URL: str = "redis://localhost:6379/0"
    USAGE_SYNC_SECONDS: int = 180
    EXPIRY_SYNC_SECONDS: int = 120
    USAGE_SYNC_BATCH_SIZE: int = 5000
    USAGE_SYNC_REMOTE_LIST_PAGE_SIZE: int = 1000
    USAGE_SYNC_REMOTE_LIST_MAX_PAGES: int = 200
    USAGE_SYNC_REMOTE_MISSING_CONFIRMATIONS: int = 3
    # A subaccount is only deleted after it has been reported missing for at
    # least this many wall-clock hours (in addition to the confirmation count),
    # so a transient panel/proxy outage that returns 404 cannot wipe live users.
    USAGE_SYNC_REMOTE_MISSING_MIN_HOURS: int = 6
    EXPIRY_SYNC_BATCH_SIZE: int = 1000

    REFUND_WINDOW_DAYS: int = 10

    CORS_ORIGINS: str = ""  # comma separated
    PANEL_TLS_VERIFY: bool = True
    HTTP_TIMEOUT_SECONDS: int = 60

    @property
    def cors_origins_list(self) -> List[str]:
        if not self.CORS_ORIGINS:
            return []
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

settings = Settings()
