from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from solders.keypair import Keypair
from solders.pubkey import Pubkey

from app.api.deps import get_db
from app.core.auth import get_current_user
from app.core.config import settings
from app.core.crypto import decrypt_key
from app.core.pacifica_margin_deposit import deposit_usdc_to_pacifica_margin
from app.core.pacifica_signing import build_signed_withdraw_request
from app.core.spl_transfer import transfer_usdc_to_destination
from app.core.wallet_balances import fetch_spl_usdc_balance
from app.models.bot_wallet import BotWallet
from app.models.user import User

router = APIRouter(tags=["funds"])


def _extract_pacifica_transaction_hash(body: dict[str, Any]) -> Optional[str]:
    if not isinstance(body, dict):
        return None
    for key in ("transaction_hash", "transaction_signature", "tx_hash"):
        v = body.get(key)
        if isinstance(v, str) and len(v) > 32:
            return v
    data = body.get("data")
    if isinstance(data, dict):
        for key in ("transaction_hash", "transaction_signature", "tx_hash", "signature", "transaction"):
            v = data.get(key)
            if isinstance(v, str) and len(v) > 32:
                return v
    return None


async def _get_bot_wallet(session: AsyncSession, user_id: uuid.UUID) -> BotWallet:
    result = await session.execute(
        select(BotWallet).where(BotWallet.user_id == user_id).limit(1),
    )
    wallet = result.scalar_one_or_none()
    if wallet is None:
        raise HTTPException(status_code=404, detail="No bot wallet for this user")
    return wallet


class DepositToPacificaBody(BaseModel):
    amount: Decimal = Field(
        ...,
        gt=0,
        description="USDC amount (6 dp) to deposit; must match PACIFICA_DEPOSIT_MINT / cluster (see python-sdk rest/deposit.py)",
    )


class DepositToPacificaResponse(BaseModel):
    transaction_hash: str


@router.post("/wallet/deposit-to-pacifica", response_model=DepositToPacificaResponse)
async def deposit_to_pacifica(
    body: DepositToPacificaBody,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> DepositToPacificaResponse:
    wallet = await _get_bot_wallet(session, current_user.id)
    balance = await fetch_spl_usdc_balance(
        settings.SOLANA_RPC_URL,
        wallet.public_key,
        settings.PACIFICA_DEPOSIT_MINT,
    )
    if Decimal(str(balance)) < body.amount:
        raise HTTPException(status_code=400, detail="Insufficient On-Chain Funds")

    decrypted: Optional[str] = None
    try:
        decrypted = decrypt_key(wallet.encrypted_private_key)
        kp = Keypair.from_base58_string(decrypted)
        if str(kp.pubkey()) != wallet.public_key:
            raise HTTPException(status_code=500, detail="Stored private key does not match public key")

        tx_sig = await deposit_usdc_to_pacifica_margin(
            rpc_url=settings.SOLANA_RPC_URL,
            bot_keypair=kp,
            amount=body.amount,
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Deposit transaction failed: {e!s}") from e
    finally:
        if decrypted is not None:
            del decrypted

    return DepositToPacificaResponse(transaction_hash=tx_sig)


class WithdrawFromPacificaBody(BaseModel):
    amount: Decimal = Field(..., gt=0, description="USDC amount to withdraw from Pacifica margin")


class WithdrawFromPacificaResponse(BaseModel):
    message: str
    transaction_hash: Optional[str] = None


@router.post("/wallet/withdraw-from-pacifica", response_model=WithdrawFromPacificaResponse)
async def withdraw_from_pacifica(
    body: WithdrawFromPacificaBody,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> WithdrawFromPacificaResponse:
    wallet = await _get_bot_wallet(session, current_user.id)
    decrypted: Optional[str] = None
    resp_body: Optional[dict[str, Any]] = None
    try:
        decrypted = decrypt_key(wallet.encrypted_private_key)
        kp = Keypair.from_base58_string(decrypted)
        if str(kp.pubkey()) != wallet.public_key:
            raise HTTPException(status_code=500, detail="Stored private key does not match public key")

        amount_str = f"{body.amount.quantize(Decimal('0.000001')):.6f}"
        payload = build_signed_withdraw_request(kp, amount_str)

        base = settings.PACIFICA_API_BASE_URL.rstrip("/")
        url = f"{base}/api/v1/account/withdraw"
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(url, json=payload)
            r.raise_for_status()
            resp_body = r.json()
    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        detail = e.response.text
        raise HTTPException(
            status_code=502,
            detail=f"Pacifica withdraw failed: HTTP {e.response.status_code} {detail}",
        ) from e
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Pacifica request failed: {e!s}") from e
    finally:
        if decrypted is not None:
            del decrypted

    if not isinstance(resp_body, dict):
        raise HTTPException(status_code=502, detail="Invalid response from Pacifica")

    if resp_body.get("success") is False:
        err = resp_body.get("error") or "Withdraw rejected"
        raise HTTPException(status_code=400, detail=str(err))

    tx_hash = _extract_pacifica_transaction_hash(resp_body)
    return WithdrawFromPacificaResponse(
        message="Withdrawal from Pacifica accepted; funds will settle on-chain shortly.",
        transaction_hash=tx_hash,
    )


class WithdrawToUserBody(BaseModel):
    amount: Decimal = Field(..., gt=0, description="USDC amount to send on-chain")
    destination_address: str = Field(..., description="Recipient Solana address (e.g. Phantom)")


class WithdrawToUserResponse(BaseModel):
    transaction_signature: str


@router.post("/wallet/withdraw-to-user", response_model=WithdrawToUserResponse)
async def withdraw_to_user(
    body: WithdrawToUserBody,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> WithdrawToUserResponse:
    wallet = await _get_bot_wallet(session, current_user.id)
    try:
        Pubkey.from_string(body.destination_address)
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid destination_address") from e

    balance = await fetch_spl_usdc_balance(
        settings.SOLANA_RPC_URL,
        wallet.public_key,
        settings.USDC_MINT,
    )
    if Decimal(str(balance)) < body.amount:
        raise HTTPException(status_code=400, detail="Insufficient On-Chain Funds")

    decrypted: Optional[str] = None
    try:
        decrypted = decrypt_key(wallet.encrypted_private_key)
        kp = Keypair.from_base58_string(decrypted)
        if str(kp.pubkey()) != wallet.public_key:
            raise HTTPException(status_code=500, detail="Stored private key does not match public key")

        sig = await transfer_usdc_to_destination(
            rpc_url=settings.SOLANA_RPC_URL,
            mint=settings.USDC_MINT,
            bot_keypair=kp,
            destination_owner_address=body.destination_address,
            amount=body.amount,
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"On-chain transfer failed: {e!s}") from e
    finally:
        if decrypted is not None:
            del decrypted

    return WithdrawToUserResponse(transaction_signature=sig)
