from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: Optional[str] = None
    token_type: str = "bearer"
    requires_2fa: bool = False
    challenge_token: Optional[str] = None
    expires_in_seconds: Optional[int] = None


class TwoFactorLoginRequest(BaseModel):
    challenge_token: str
    code: str = Field(min_length=4, max_length=64)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class TwoFactorStatusResponse(BaseModel):
    enabled: bool
    confirmed_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    recovery_codes_remaining: int = 0


class TwoFactorSetupRequest(BaseModel):
    current_password: str


class TwoFactorSetupResponse(BaseModel):
    secret: str
    otpauth_uri: str
    issuer: str
    account_name: str
    digits: int = 6
    period_seconds: int = 30
    algorithm: str = "SHA1"


class TwoFactorEnableRequest(BaseModel):
    current_password: str
    secret: str
    code: str = Field(min_length=4, max_length=64)


class TwoFactorRecoveryCodesResponse(BaseModel):
    recovery_codes: list[str]


class TwoFactorVerifyRequest(BaseModel):
    current_password: str
    code: str = Field(min_length=4, max_length=64)


class MeResponse(BaseModel):
    username: str
    role: str
    reseller_id: int
    balance: int
    status: str
    price_per_gb: int
    bundle_price_per_gb: int
    price_per_day: int
    can_create_subreseller: bool
    two_factor_enabled: bool = False
