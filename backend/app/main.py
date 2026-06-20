import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.responses import JSONResponse
from app.core.config import settings
from app.api.v1.router import api_router
from app.core.db import AsyncSessionLocal
from sqlalchemy import text
from redis.asyncio import Redis

logger = logging.getLogger(__name__)

OPENAPI_URL = "/api/openapi.json"

_INSECURE_SECRET_KEYS = {"", "please-change-me", "changeme", "change-me"}


def _validate_runtime_security() -> None:
    """Fail fast in production when the JWT signing key is a known placeholder.

    A properly installed Guardino server has a randomized SECRET_KEY (the
    installer rotates it), so this never trips on a real deployment. It only
    guards against accidentally running with the public default value, which
    would let anyone forge admin tokens.
    """
    env = str(getattr(settings, "ENV", "dev") or "dev").strip().lower()
    secret = str(getattr(settings, "SECRET_KEY", "") or "").strip()
    if env not in {"dev", "test", "local"} and secret.lower() in _INSECURE_SECRET_KEYS:
        raise RuntimeError(
            "SECRET_KEY is set to an insecure default. Set a strong random "
            "SECRET_KEY in .env before starting in production (e.g. `openssl rand -hex 32`)."
        )
    if len(secret) < 32:
        logger.warning(
            "SECRET_KEY is shorter than 32 characters; use a longer random value for production."
        )


app = FastAPI(
    title=settings.APP_NAME,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.on_event("startup")
async def _on_startup() -> None:
    _validate_runtime_security()

if settings.cors_origins_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(api_router, prefix="/api/v1")


def _docs_guard() -> None:
    if not bool(getattr(settings, "EXPOSE_API_DOCS", True)):
        raise HTTPException(status_code=404, detail="Not Found")


@app.get("/api/docs", include_in_schema=False)
async def docs_alias():
    _docs_guard()
    return get_swagger_ui_html(openapi_url=OPENAPI_URL, title=f"{settings.APP_NAME} API docs")


@app.get("/docs", include_in_schema=False)
async def docs():
    _docs_guard()
    return get_swagger_ui_html(openapi_url=OPENAPI_URL, title=f"{settings.APP_NAME} API docs")


@app.get("/api/redoc", include_in_schema=False)
async def redoc_alias():
    _docs_guard()
    return get_redoc_html(openapi_url=OPENAPI_URL, title=f"{settings.APP_NAME} ReDoc")


@app.get("/redoc", include_in_schema=False)
async def redoc():
    _docs_guard()
    return get_redoc_html(openapi_url=OPENAPI_URL, title=f"{settings.APP_NAME} ReDoc")


@app.get("/api/openapi.json", include_in_schema=False)
async def openapi_alias():
    _docs_guard()
    return JSONResponse(app.openapi())


@app.get("/openapi.json", include_in_schema=False)
async def openapi():
    _docs_guard()
    return JSONResponse(app.openapi())

@app.get("/health")
async def health():
    db_ok = False
    redis_ok = False
    try:
        async with AsyncSessionLocal() as s:
            await s.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False
    rds = Redis.from_url(settings.REDIS_URL, decode_responses=True)
    try:
        redis_ok = bool(await rds.ping())
    except Exception:
        redis_ok = False
    finally:
        await rds.aclose()
    healthy = db_ok and redis_ok
    return JSONResponse(
        status_code=200 if healthy else 503,
        content={"status": "ok" if healthy else "degraded", "db_ok": db_ok, "redis_ok": redis_ok},
    )
