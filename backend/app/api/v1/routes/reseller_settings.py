from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_reseller
from app.core.db import get_db
from app.schemas.settings import UserDefaults, UserDefaultsEnvelope
from app.schemas.settings import ResellerUserPolicy
from app.services.user_defaults import (
    GLOBAL_USER_DEFAULTS_KEY,
    base_user_defaults,
    get_user_defaults_setting,
    get_user_defaults_setting_optional,
    reseller_user_defaults_key,
    set_user_defaults_setting,
)
from app.services.reseller_user_policy import (
    get_user_policy_setting,
    reseller_user_policy_key,
)

router = APIRouter()


@router.get("/user-defaults", response_model=UserDefaultsEnvelope)
async def get_user_defaults(db: AsyncSession = Depends(get_db), reseller=Depends(require_reseller)):
    global_defaults = await get_user_defaults_setting(db, GLOBAL_USER_DEFAULTS_KEY)
    reseller_defaults = await get_user_defaults_setting_optional(db, reseller_user_defaults_key(reseller.id))
    if reseller_defaults is None:
        reseller_defaults = base_user_defaults()
        effective = global_defaults
    else:
        effective = {**global_defaults, **reseller_defaults}
    return UserDefaultsEnvelope(
        global_defaults=UserDefaults(**global_defaults),
        reseller_defaults=UserDefaults(**reseller_defaults),
        effective=UserDefaults(**effective),
    )


@router.put("/user-defaults", response_model=UserDefaults)
async def put_user_defaults(
    payload: UserDefaults,
    db: AsyncSession = Depends(get_db),
    reseller=Depends(require_reseller),
):
    saved = await set_user_defaults_setting(db, reseller_user_defaults_key(reseller.id), payload.model_dump())
    return UserDefaults(**saved)


@router.get("/user-policy", response_model=ResellerUserPolicy)
async def get_user_policy(
    db: AsyncSession = Depends(get_db),
    reseller=Depends(require_reseller),
):
    policy = await get_user_policy_setting(db, reseller_user_policy_key(reseller.id))
    return ResellerUserPolicy(**policy)
