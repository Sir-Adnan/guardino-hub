from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.core.db import get_db
from app.schemas.settings import UserDefaults
from app.services.user_defaults import (
    GLOBAL_USER_DEFAULTS_KEY,
    get_user_defaults_setting,
    set_user_defaults_setting,
)

router = APIRouter()


@router.get("/user-defaults", response_model=UserDefaults)
async def get_global_user_defaults(db: AsyncSession = Depends(get_db), admin=Depends(require_admin)):
    defaults = await get_user_defaults_setting(db, GLOBAL_USER_DEFAULTS_KEY)
    return UserDefaults(**defaults)


@router.put("/user-defaults", response_model=UserDefaults)
async def put_global_user_defaults(
    payload: UserDefaults,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
):
    saved = await set_user_defaults_setting(db, GLOBAL_USER_DEFAULTS_KEY, payload.model_dump())
    return UserDefaults(**saved)
