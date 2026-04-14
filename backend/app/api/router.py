from fastapi import APIRouter

from app.api import auth, funds, trading, account
from app.api.routes import health, wallets

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth")
api_router.include_router(health.router, tags=["system"])
api_router.include_router(wallets.router)
api_router.include_router(funds.router)
api_router.include_router(trading.router)
api_router.include_router(account.router)
