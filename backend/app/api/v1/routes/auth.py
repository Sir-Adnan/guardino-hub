from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.db import get_db
from app.core.security import verify_password, create_access_token, hash_password
from app.schemas.auth import LoginRequest, TokenResponse, ChangePasswordRequest
from app.models.reseller import Reseller, ResellerStatus
from app.api.deps import get_current_principal

router = APIRouter()

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

@router.get("/me")
async def me(principal=Depends(get_current_principal)):
    reseller, role = principal
    return {
        "username": reseller.username,
        "role": role.value,
        "reseller_id": reseller.id,
        "balance": reseller.balance,
        "status": reseller.status.value,
    }


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
