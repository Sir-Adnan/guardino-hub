from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone

from app.core.db import get_db
from app.core.config import settings
from app.core.security import verify_password, create_access_token, hash_password
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    MeResponse,
    TokenResponse,
    TwoFactorEnableRequest,
    TwoFactorLoginRequest,
    TwoFactorRecoveryCodesResponse,
    TwoFactorSetupRequest,
    TwoFactorSetupResponse,
    TwoFactorStatusResponse,
    TwoFactorVerifyRequest,
)
from app.models.reseller import Reseller, ResellerStatus
from app.api.deps import get_current_principal
from app.models.api_token import ApiToken
from app.schemas.api_tokens import ApiTokenCreateRequest, ApiTokenCreated, ApiTokenList
from app.services.api_tokens import api_token_to_out, create_api_token
from app.services.auth_rate_limit import clear_auth_identity_limit, enforce_auth_rate_limit
from app.services.two_factor import (
    RECOVERY_CODE_COUNT,
    TOTP_ALGORITHM,
    TOTP_DIGITS,
    TOTP_PERIOD_SECONDS,
    TWO_FACTOR_CHALLENGE_MINUTES,
    build_otpauth_uri,
    create_two_factor_challenge_token,
    datetime_for_totp_step,
    decode_two_factor_challenge_token,
    encrypt_secret,
    generate_recovery_codes,
    generate_totp_secret,
    hash_recovery_codes,
    totp_step_from_datetime,
    verify_reseller_second_factor,
    verify_totp,
)

router = APIRouter()


def _datetime_in_past(value: datetime | None) -> bool:
    if value is None:
        return False
    now = datetime.now(value.tzinfo) if value.tzinfo else datetime.utcnow()
    return value <= now

@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    rate_identity = payload.username.strip().lower()
    await enforce_auth_rate_limit(request, action="password", identity=rate_identity)
    q = await db.execute(select(Reseller).where(Reseller.username == payload.username))
    user = q.scalar_one_or_none()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="نام کاربری یا رمز عبور اشتباه است.")

    if user.status in (ResellerStatus.disabled, ResellerStatus.deleted):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="حساب کاربری شما غیرفعال است.")

    # IMPORTANT: role must come from the database, not from parent_id.
    # Otherwise a reseller with parent_id=None could become an admin.
    role = (user.role or "reseller").strip().lower()
    await clear_auth_identity_limit(action="password", identity=rate_identity)
    if bool(getattr(user, "two_factor_enabled", False)):
        challenge = create_two_factor_challenge_token(user, role)
        return TokenResponse(
            requires_2fa=True,
            challenge_token=challenge,
            expires_in_seconds=TWO_FACTOR_CHALLENGE_MINUTES * 60,
        )

    token = create_access_token(subject=user.username, role=role)
    return TokenResponse(
        access_token=token,
        expires_in_seconds=int(settings.ACCESS_TOKEN_EXPIRE_MINUTES) * 60,
    )


@router.post("/login/2fa", response_model=TokenResponse)
async def login_two_factor(payload: TwoFactorLoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    challenge = decode_two_factor_challenge_token(payload.challenge_token)
    if not challenge:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Two-factor challenge is invalid or expired.")

    username = str(challenge.get("sub") or "")
    reseller_id = int(challenge.get("rid") or 0)
    rate_identity = f"{reseller_id}:{username}"
    await enforce_auth_rate_limit(request, action="two-factor", identity=rate_identity)
    q = await db.execute(select(Reseller).where(Reseller.id == reseller_id, Reseller.username == username))
    user = q.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found.")
    if user.status in (ResellerStatus.disabled, ResellerStatus.deleted):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled.")
    role = (user.role or "reseller").strip().lower()
    if not bool(getattr(user, "two_factor_enabled", False)):
        await clear_auth_identity_limit(action="two-factor", identity=rate_identity)
        token = create_access_token(subject=user.username, role=role)
        return TokenResponse(
            access_token=token,
            expires_in_seconds=int(settings.ACCESS_TOKEN_EXPIRE_MINUTES) * 60,
        )

    last_used_step = totp_step_from_datetime(getattr(user, "two_factor_last_used_at", None))
    ok, _used_recovery, used_step = verify_reseller_second_factor(user, payload.code, last_used_step=last_used_step)
    if not ok:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid two-factor code.")
    user.two_factor_last_used_at = datetime_for_totp_step(used_step) if used_step is not None else datetime.now(timezone.utc)
    await db.commit()
    await clear_auth_identity_limit(action="two-factor", identity=rate_identity)

    token = create_access_token(subject=user.username, role=role, mfa=True)
    return TokenResponse(
        access_token=token,
        expires_in_seconds=int(settings.ACCESS_TOKEN_EXPIRE_MINUTES) * 60,
    )

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
        two_factor_enabled=bool(getattr(reseller, "two_factor_enabled", False)),
    )


@router.get("/2fa/status", response_model=TwoFactorStatusResponse)
async def two_factor_status(principal=Depends(get_current_principal)):
    reseller, _role = principal
    recovery_hashes = getattr(reseller, "two_factor_recovery_hashes", []) or []
    return TwoFactorStatusResponse(
        enabled=bool(getattr(reseller, "two_factor_enabled", False)),
        confirmed_at=getattr(reseller, "two_factor_confirmed_at", None),
        last_used_at=getattr(reseller, "two_factor_last_used_at", None),
        recovery_codes_remaining=len(recovery_hashes),
    )


@router.post("/2fa/setup", response_model=TwoFactorSetupResponse)
async def two_factor_setup(payload: TwoFactorSetupRequest, principal=Depends(get_current_principal)):
    reseller, _role = principal
    if not verify_password(payload.current_password, reseller.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect.")
    secret = generate_totp_secret()
    issuer = "Guardino Hub"
    return TwoFactorSetupResponse(
        secret=secret,
        otpauth_uri=build_otpauth_uri(secret, reseller.username, issuer),
        issuer=issuer,
        account_name=reseller.username,
        digits=TOTP_DIGITS,
        period_seconds=TOTP_PERIOD_SECONDS,
        algorithm=TOTP_ALGORITHM,
    )


@router.post("/2fa/enable", response_model=TwoFactorRecoveryCodesResponse)
async def two_factor_enable(
    payload: TwoFactorEnableRequest,
    db: AsyncSession = Depends(get_db),
    principal=Depends(get_current_principal),
):
    reseller, _role = principal
    if not verify_password(payload.current_password, reseller.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect.")
    if not verify_totp(payload.secret, payload.code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid authenticator code.")

    recovery_codes = generate_recovery_codes(RECOVERY_CODE_COUNT)
    now = datetime.now(timezone.utc)
    reseller.two_factor_enabled = True
    reseller.two_factor_secret_enc = encrypt_secret(payload.secret)
    reseller.two_factor_recovery_hashes = hash_recovery_codes(recovery_codes)
    reseller.two_factor_confirmed_at = now
    reseller.two_factor_last_used_at = now
    await db.commit()
    return TwoFactorRecoveryCodesResponse(recovery_codes=recovery_codes)


@router.post("/2fa/disable")
async def two_factor_disable(
    payload: TwoFactorVerifyRequest,
    db: AsyncSession = Depends(get_db),
    principal=Depends(get_current_principal),
):
    reseller, _role = principal
    if not verify_password(payload.current_password, reseller.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect.")
    if bool(getattr(reseller, "two_factor_enabled", False)):
        last_used_step = totp_step_from_datetime(getattr(reseller, "two_factor_last_used_at", None))
        ok, _used_recovery, _used_step = verify_reseller_second_factor(reseller, payload.code, last_used_step=last_used_step)
        if not ok:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid two-factor code.")
    reseller.two_factor_enabled = False
    reseller.two_factor_secret_enc = None
    reseller.two_factor_recovery_hashes = []
    reseller.two_factor_confirmed_at = None
    reseller.two_factor_last_used_at = None
    await db.commit()
    return {"ok": True}


@router.post("/2fa/recovery-codes", response_model=TwoFactorRecoveryCodesResponse)
async def two_factor_regenerate_recovery_codes(
    payload: TwoFactorVerifyRequest,
    db: AsyncSession = Depends(get_db),
    principal=Depends(get_current_principal),
):
    reseller, _role = principal
    if not bool(getattr(reseller, "two_factor_enabled", False)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Two-factor authentication is not enabled.")
    if not verify_password(payload.current_password, reseller.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect.")
    last_used_step = totp_step_from_datetime(getattr(reseller, "two_factor_last_used_at", None))
    ok, _used_recovery, used_step = verify_reseller_second_factor(reseller, payload.code, last_used_step=last_used_step)
    if not ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid two-factor code.")
    if used_step is not None:
        reseller.two_factor_last_used_at = datetime_for_totp_step(used_step)
    recovery_codes = generate_recovery_codes(RECOVERY_CODE_COUNT)
    reseller.two_factor_recovery_hashes = hash_recovery_codes(recovery_codes)
    await db.commit()
    return TwoFactorRecoveryCodesResponse(recovery_codes=recovery_codes)


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
