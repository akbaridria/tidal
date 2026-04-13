from __future__ import annotations

import asyncio
import base58
import uuid
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from solders.keypair import Keypair

from app.api.deps import get_db
from app.core.auth import get_current_user
from app.core.config import settings
from app.core.crypto import decrypt_key, encrypt_key, wipe_bytearray
from app.core.wallet_balances import (
    fetch_native_sol_balance_sol,
    fetch_pacifica_account_summary,
    fetch_spl_usdc_balance,
)
from app.models.bot_wallet import BotWallet
from app.models.user import User

router = APIRouter(tags=["wallets"])


class GenerateWalletResponse(BaseModel):
    public_key: str = Field(..., description="Solana wallet public key (base58)")


class GenerateWalletBody(BaseModel):
    pass


@router.post("/generate-wallet", response_model=GenerateWalletResponse)
async def generate_wallet(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> GenerateWalletResponse:
    keypair = Keypair()
    public_key = str(keypair.pubkey())

    raw_private_key_b58 = base58.b58encode(keypair.to_bytes()).decode("ascii")
    buf = bytearray(raw_private_key_b58.encode("utf-8"))
    del raw_private_key_b58

    try:
        encrypted = encrypt_key(bytes(buf))
    finally:
        wipe_bytearray(buf)

    wallet = BotWallet(
        user_id=current_user.id,
        public_key=public_key,
        encrypted_private_key=encrypted,
    )
    session.add(wallet)
    await session.commit()

    return GenerateWalletResponse(public_key=public_key)


@router.get("/wallet/balances")
async def get_wallet_balances(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    result = await session.execute(
        select(BotWallet).where(BotWallet.user_id == current_user.id).limit(1),
    )
    wallet = result.scalar_one_or_none()
    if wallet is None:
        raise HTTPException(status_code=404, detail="No bot wallet for this user")

    decrypted: Optional[str] = None
    try:
        decrypted = decrypt_key(wallet.encrypted_private_key)
        kp = Keypair.from_base58_string(decrypted)
        if str(kp.pubkey()) != wallet.public_key:
            raise HTTPException(
                status_code=500,
                detail="Stored private key does not match public key",
            )

        (sol, lamports), usdc, pacifica = await asyncio.gather(
            fetch_native_sol_balance_sol(settings.SOLANA_RPC_URL, wallet.public_key),
            fetch_spl_usdc_balance(
                settings.SOLANA_RPC_URL,
                wallet.public_key,
                settings.USDC_MINT,
            ),
            fetch_pacifica_account_summary(wallet.public_key, decrypted),
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Pacifica HTTP {e.response.status_code}",
        ) from e
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Request failed: {e!s}") from e
    finally:
        if decrypted is not None:
            del decrypted

    return {
        "user_id": str(current_user.id),
        "public_key": wallet.public_key,
        "bot_wallet_balance": {
            "sol": sol,
            "sol_lamports": lamports,
            "usdc": usdc,
        },
        "pacifica_balance": {
            "available_margin_collateral": pacifica.get("available_margin_collateral"),
            "account_equity": pacifica.get("account_equity"),
            "balance": pacifica.get("balance"),
        },
    }
