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
from app.services.api_tokens import TOKEN_PREFIX, find_active_api_token, touch_api_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def _role_for(reseller: Reseller) -> Role:
    try:
        return Role((reseller.role or "reseller").strip().lower())
    except Exception:
        return Role.reseller


def _ensure_active_reseller(reseller: Reseller) -> None:
    if reseller.status in (ResellerStatus.disabled, ResellerStatus.deleted):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="حساب کاربری شما غیرفعال است.")


async def get_current_principal(
    request: Request,
    db: AsyncSession = Depends(get_db),
    token: str = Depends(oauth2_scheme),
) -> tuple[Reseller, Role]:
    # Dispatch by credential type instead of falling through on decode errors.
    # API tokens always carry the TOKEN_PREFIX; everything else is treated as a
    # JWT, so an expired/invalid JWT is rejected outright rather than being
    # reinterpreted as a (never-matching) API-token lookup.
    if not token.startswith(TOKEN_PREFIX):
        try:
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        except JWTError:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="توکن نامعتبر است.")
        sub: str | None = payload.get("sub")
        token_role: str | None = payload.get("role")
        token_mfa = bool(payload.get("mfa", False))
        if not sub or not token_role:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="توکن نامعتبر است.")

        q = await db.execute(select(Reseller).where(Reseller.username == sub))
        reseller = q.scalar_one_or_none()
        if not reseller:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="کاربر یافت نشد.")

        _ensure_active_reseller(reseller)

        # IMPORTANT: role is authoritative in the database.
        # The JWT role claim is treated as a cache only.
        db_role = _role_for(reseller)

        # If role was changed in the DB, old tokens should stop working.
        if token_role != db_role.value:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="توکن نامعتبر است.")

        if bool(getattr(reseller, "two_factor_enabled", False)) and not token_mfa:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Two-factor authentication is required.")

        request.state.auth_type = "jwt"
        return reseller, db_role

    api_token = await find_active_api_token(db, token)
    if not api_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="توکن نامعتبر است.")

    q = await db.execute(select(Reseller).where(Reseller.id == api_token.reseller_id))
    reseller = q.scalar_one_or_none()
    if not reseller:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="کاربر یافت نشد.")

    _ensure_active_reseller(reseller)
    db_role = _role_for(reseller)
    await touch_api_token(db, api_token)

    request.state.auth_type = "api_token"
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
    # Balance-zero resellers can still read their catalog/users/reports and
    # quote prices. Mutating user operations remain blocked except revoke/delete
    # flows handled explicitly by their endpoints.
    # Deletion is handled by the refund endpoint after inspecting the request body.
    if reseller.balance > 0:
        return
    allowed = (
        (request_method == "GET" and request_path.startswith("/api/v1/reseller/"))
        or (request_method == "POST" and request_path.endswith("/user-ops/quote"))
        or (request_method == "POST" and request_path.endswith("/revoke"))
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="موجودی شما صفر است؛ ساخت و ویرایش کاربر غیرفعال است.",
        )


async def block_if_balance_zero(request: Request, principal=Depends(get_current_principal)) -> Reseller:
    reseller, role = principal
    # Admin is never blocked by balance checks.
    if role == Role.admin:
        return reseller
    enforce_balance_or_readonly_users(reseller, request.url.path, request.method)
    return reseller
