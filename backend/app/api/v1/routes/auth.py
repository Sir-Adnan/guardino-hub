from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.db import get_db
from app.core.security import verify_password, create_access_token
from app.schemas.auth import LoginRequest, TokenResponse
from app.models.reseller import Reseller

router = APIRouter()

@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    q = await db.execute(select(Reseller).where(Reseller.username == payload.username))
    user = q.scalar_one_or_none()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    role = "admin" if user.parent_id is None else "reseller"
    token = create_access_token(subject=user.username, role=role)
    return TokenResponse(access_token=token)

@router.get("/me")
async def me(db: AsyncSession = Depends(get_db), principal=Depends(__import__("app.api.deps", fromlist=["get_current_principal"]).get_current_principal)):
    reseller, role = principal
    return {
        "username": reseller.username,
        "role": role,
        "reseller_id": reseller.id,
        "balance": reseller.balance,
        "status": reseller.status.value,
    }
