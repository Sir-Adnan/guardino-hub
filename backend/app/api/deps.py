from fastapi import Depends, HTTPException, status, Request
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


async def get_current_principal(
    db: AsyncSession = Depends(get_db),
    token: str = Depends(oauth2_scheme),
) -> tuple[Reseller, Role]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        sub: str | None = payload.get("sub")
        token_role: str | None = payload.get("role")
        if not sub or not token_role:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="توکن نامعتبر است.")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="توکن نامعتبر است.")

    q = await db.execute(select(Reseller).where(Reseller.username == sub))
    reseller = q.scalar_one_or_none()
    if not reseller:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="کاربر یافت نشد.")

    if reseller.status in (ResellerStatus.disabled, ResellerStatus.deleted):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="حساب کاربری شما غیرفعال است.")

    # IMPORTANT: role is authoritative in the database.
    # The JWT role claim is treated as a cache only.
    try:
        db_role = Role((reseller.role or "reseller").strip().lower())
    except Exception:
        db_role = Role.reseller

    # If role was changed in the DB, old tokens should stop working.
    if token_role != db_role.value:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="توکن نامعتبر است.")

    return reseller, db_role


async def require_admin(principal=Depends(get_current_principal)) -> Reseller:
    reseller, role = principal
    if role != Role.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="فقط ادمین مجاز است.")
    return reseller


async def require_reseller(principal=Depends(get_current_principal)) -> Reseller:
    reseller, role = principal
    if role not in (Role.reseller, Role.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="دسترسی غیرمجاز.")
    return reseller


def enforce_balance_or_readonly_users(reseller: Reseller, request_path: str, request_method: str) -> None:
    # If balance <= 0, reseller can ONLY GET the exact users list endpoint.
    if reseller.balance > 0:
        return
    allowed = (request_method == "GET" and request_path == "/api/v1/reseller/users")
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="بالانس شما صفر است و فقط مشاهده لیست کاربران مجاز است.",
        )


async def block_if_balance_zero(request: Request, principal=Depends(get_current_principal)) -> Reseller:
    reseller, role = principal
    # Admin is never blocked by balance checks.
    if role == Role.admin:
        return reseller
    enforce_balance_or_readonly_users(reseller, request.url.path, request.method)
    return reseller
