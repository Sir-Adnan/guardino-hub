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

    DATABASE_URL: str

    REDIS_URL: str = "redis://localhost:6379/0"

    REFUND_WINDOW_DAYS: int = 10

    CORS_ORIGINS: str = ""  # comma separated
    PANEL_TLS_VERIFY: bool = True
    HTTP_TIMEOUT_SECONDS: int = 15

    @property
    def cors_origins_list(self) -> List[str]:
        if not self.CORS_ORIGINS:
            return []
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

settings = Settings()
