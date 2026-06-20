from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.responses import JSONResponse
from app.core.config import settings
from app.api.v1.router import api_router
from app.core.db import AsyncSessionLocal
from sqlalchemy import text
from redis.asyncio import Redis

OPENAPI_URL = "/api/openapi.json"

app = FastAPI(
    title=settings.APP_NAME,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

if settings.cors_origins_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(api_router, prefix="/api/v1")


@app.get("/api/docs", include_in_schema=False)
async def docs_alias():
    return get_swagger_ui_html(openapi_url=OPENAPI_URL, title=f"{settings.APP_NAME} API docs")


@app.get("/docs", include_in_schema=False)
async def docs():
    return get_swagger_ui_html(openapi_url=OPENAPI_URL, title=f"{settings.APP_NAME} API docs")


@app.get("/api/redoc", include_in_schema=False)
async def redoc_alias():
    return get_redoc_html(openapi_url=OPENAPI_URL, title=f"{settings.APP_NAME} ReDoc")


@app.get("/redoc", include_in_schema=False)
async def redoc():
    return get_redoc_html(openapi_url=OPENAPI_URL, title=f"{settings.APP_NAME} ReDoc")


@app.get("/api/openapi.json", include_in_schema=False)
async def openapi_alias():
    return JSONResponse(app.openapi())


@app.get("/openapi.json", include_in_schema=False)
async def openapi():
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
