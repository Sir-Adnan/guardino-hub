from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone

from app.core.db import get_db
from app.core.security import verify_password, create_access_token, hash_password
from app.schemas.auth import LoginRequest, TokenResponse, ChangePasswordRequest, MeResponse
from app.models.reseller import Reseller, ResellerStatus
from app.api.deps import get_current_principal
from app.models.api_token import ApiToken
from app.schemas.api_tokens import ApiTokenCreateRequest, ApiTokenCreated, ApiTokenList
from app.services.api_tokens import api_token_to_out, create_api_token

router = APIRouter()


def _datetime_in_past(value: datetime | None) -> bool:
    if value is None:
        return False
    now = datetime.now(value.tzinfo) if value.tzinfo else datetime.utcnow()
    return value <= now

@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    q = await db.execute(select(Reseller).where(Reseller.username == payload.username))
    user = q.scalar_one_or_none()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="نام کاربری یا رمز عبور اشتباه است.")

    if user.status in (ResellerStatus.disabled, ResellerStatus.deleted):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="حساب کاربری شما غیرفعال است.")

    # IMPORTANT: role must come from the database, not from parent_id.
    # Otherwise a reseller with parent_id=None could become an admin.
    role = (user.role or "reseller").strip().lower()
    token = create_access_token(subject=user.username, role=role)
    return TokenResponse(access_token=token)

@router.get("/me", response_model=MeResponse)
async def me(principal=Depends(get_current_principal)):
    reseller, role = principal
    return MeResponse(
        username=reseller.username,
        role=role.value,
        reseller_id=reseller.id,
        balance=reseller.balance,
        status=reseller.status.value,
        price_per_gb=int(reseller.price_per_gb or 0),
        bundle_price_per_gb=int(getattr(reseller, "bundle_price_per_gb", 0) or 0),
        price_per_day=int(reseller.price_per_day or 0),
        can_create_subreseller=bool(getattr(reseller, "can_create_subreseller", False)),
    )


@router.post("/change-password")
async def change_password(
    payload: ChangePasswordRequest,
    db: AsyncSession = Depends(get_db),
    principal=Depends(get_current_principal),
):
    reseller, _role = principal

    if not verify_password(payload.current_password, reseller.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="رمز فعلی صحیح نیست.")

    new_password = (payload.new_password or "").strip()
    if len(new_password) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="رمز جدید باید حداقل ۸ کاراکتر باشد.")
    if verify_password(new_password, reseller.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="رمز جدید نباید با رمز فعلی یکسان باشد.")

    reseller.password_hash = hash_password(new_password)
    await db.commit()
    return {"ok": True}


@router.get("/api-tokens", response_model=ApiTokenList)
async def list_own_api_tokens(
    db: AsyncSession = Depends(get_db),
    principal=Depends(get_current_principal),
):
    reseller, _role = principal
    q = await db.execute(
        select(ApiToken)
        .where(ApiToken.reseller_id == reseller.id)
        .order_by(ApiToken.id.desc())
    )
    items = [api_token_to_out(t) for t in q.scalars().all()]
    return ApiTokenList(items=items, total=len(items))


@router.post("/api-tokens", response_model=ApiTokenCreated)
async def create_own_api_token(
    payload: ApiTokenCreateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal=Depends(get_current_principal),
):
    reseller, _role = principal
    if getattr(request.state, "auth_type", "") == "api_token":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="API tokens cannot create new API tokens.")
    if _datetime_in_past(payload.expires_at):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="expires_at must be in the future.")
    record, raw_token = await create_api_token(
        db,
        reseller=reseller,
        name=payload.name,
        created_by=reseller,
        expires_at=payload.expires_at,
    )
    return ApiTokenCreated(**api_token_to_out(record).model_dump(), token=raw_token)


@router.delete("/api-tokens/{token_id}")
async def revoke_own_api_token(
    token_id: int,
    db: AsyncSession = Depends(get_db),
    principal=Depends(get_current_principal),
):
    reseller, _role = principal
    q = await db.execute(
        select(ApiToken).where(
            ApiToken.id == token_id,
            ApiToken.reseller_id == reseller.id,
        )
    )
    token = q.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API token not found")
    token.revoked_at = datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True}
