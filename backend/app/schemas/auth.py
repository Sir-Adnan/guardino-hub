from pydantic import BaseModel

class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


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
