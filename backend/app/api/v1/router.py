from fastapi import APIRouter
from app.api.v1.routes import auth, reseller_users

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(reseller_users.router, prefix="/reseller/users", tags=["reseller-users"])
