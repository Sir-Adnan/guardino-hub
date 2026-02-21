from fastapi import APIRouter
from app.api.v1.routes import (
    auth,
    reseller_users,
    admin_resellers,
    admin_nodes,
    admin_allocations,
)

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(reseller_users.router, prefix="/reseller/users", tags=["reseller-users"])

api_router.include_router(admin_resellers.router, prefix="/admin/resellers", tags=["admin-resellers"])
api_router.include_router(admin_nodes.router, prefix="/admin/nodes", tags=["admin-nodes"])
api_router.include_router(admin_allocations.router, prefix="/admin/allocations", tags=["admin-allocations"])
