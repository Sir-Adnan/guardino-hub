from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from app.core.config import settings
from app.api.v1.router import api_router
from app.core.db import AsyncSessionLocal
from sqlalchemy import text
import redis

app = FastAPI(title=settings.APP_NAME)

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
    return RedirectResponse(url="/docs")


@app.get("/api/redoc", include_in_schema=False)
async def redoc_alias():
    return RedirectResponse(url="/redoc")


@app.get("/api/openapi.json", include_in_schema=False)
async def openapi_alias():
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
    try:
        rds = redis.Redis.from_url(settings.REDIS_URL)
        redis_ok = bool(rds.ping())
    except Exception:
        redis_ok = False
    return {"status": "ok" if db_ok and redis_ok else "degraded", "db_ok": db_ok, "redis_ok": redis_ok}
