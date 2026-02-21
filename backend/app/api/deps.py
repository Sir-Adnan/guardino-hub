from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_db
from app.core.security import ALGORITHM
from app.core.rbac import Role
from app.models.reseller import Reseller, ResellerStatus

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

async def get_current_principal(db: AsyncSession = Depends(get_db), token: str = Depends(oauth2_scheme)) -> tuple[Reseller, str]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        sub: str = payload.get("sub")
        role: str = payload.get("role")
        if not sub or not role:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    q = await db.execute(select(Reseller).where(Reseller.username == sub))
    reseller = q.scalar_one_or_none()
    if not reseller:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    if reseller.status in (ResellerStatus.suspended,):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account suspended")

    return reseller, role

async def require_admin(principal = Depends(get_current_principal)) -> Reseller:
    reseller, role = principal
    if role != Role.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    return reseller

async def require_reseller(principal = Depends(get_current_principal)) -> Reseller:
    reseller, role = principal
    if role not in (Role.reseller, Role.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return reseller

def enforce_balance_or_readonly_users(reseller: Reseller, request_path: str, request_method: str):
    # Requirement from product:
    # If balance == 0 (or below), reseller can ONLY list users.
    if reseller.balance > 0:
        return
    allowed = (request_method == "GET" and request_path.startswith("/api/v1/reseller/users"))
    if not allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Balance is zero: read-only (users list only)")


from fastapi import Request

async def block_if_balance_zero(request: Request, reseller: Reseller = Depends(require_reseller)):
    # Global reseller lock: if balance <= 0, only allow GET /api/v1/reseller/users (list)
    enforce_balance_or_readonly_users(reseller, request.url.path, request.method)
    return reseller
