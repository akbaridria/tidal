from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Any, Optional
from solders.keypair import Keypair

from app.api.deps import get_db
from app.api.funds import _get_bot_wallet
from app.core.auth import get_current_user
from app.core.config import settings
from app.core.crypto import decrypt_key
from app.core.pacifica_signing import build_signed_leverage_request, build_signed_margin_request
from app.models.bot_wallet import BotWallet
from app.models.user import User

router = APIRouter(prefix="/account", tags=["account"])

@router.get("/settings")
async def get_account_settings(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    wallet = await _get_bot_wallet(session, current_user.id)
    url = f"{settings.PACIFICA_API_BASE_URL.rstrip('/')}/api/v1/account/settings?account={wallet.public_key}"
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(url)
        if r.status_code != 200:
            raise HTTPException(status_code=r.status_code, detail=f"Pacifica error: {r.text}")
        
        data = r.json()
        if not data.get("success"):
            raise HTTPException(status_code=400, detail=str(data.get("error", "Unknown error")))
            
        return data["data"]


class UpdateLeverageBody(BaseModel):
    symbol: str
    leverage: int
    isolated: Optional[bool] = None

@router.post("/leverage")
async def update_leverage(
    body: UpdateLeverageBody,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    wallet = await _get_bot_wallet(session, current_user.id)
    
    decrypted: Optional[str] = None
    try:
        decrypted = decrypt_key(wallet.encrypted_private_key)
        kp = Keypair.from_base58_string(decrypted)
        
        # 1. Update Leverage
        lev_payload = build_signed_leverage_request(kp, body.symbol, body.leverage)
        lev_url = f"{settings.PACIFICA_API_BASE_URL.rstrip('/')}/api/v1/account/leverage"
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(lev_url, json=lev_payload)
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail=f"Pacifica Leverage Error: {r.text}")

            # 2. Update Margin Mode (if provided)
            if body.isolated is not None:
                mar_payload = build_signed_margin_request(kp, body.symbol, body.isolated)
                mar_url = f"{settings.PACIFICA_API_BASE_URL.rstrip('/')}/api/v1/account/margin"
                r = await client.post(mar_url, json=mar_payload)
                if r.status_code != 200:
                    raise HTTPException(status_code=r.status_code, detail=f"Pacifica Margin Error: {r.text}")

            return {
                "success": True, 
                "message": f"Settings updated for {body.symbol}: {body.leverage}x" + (f" ({'Isolated' if body.isolated else 'Cross'})" if body.isolated is not None else "")
            }


    finally:
        if decrypted is not None:
            del decrypted
