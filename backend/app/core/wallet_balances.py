from __future__ import annotations

from typing import Any

import httpx
from solders.keypair import Keypair
from solana.rpc.async_api import AsyncClient
from solana.rpc.types import TokenAccountOpts
from solders.pubkey import Pubkey

from app.core.config import settings


async def fetch_native_sol_balance_sol(rpc_url: str, owner_pubkey: str) -> tuple[float, int]:
    """Return (SOL as float, lamports)."""
    owner = Pubkey.from_string(owner_pubkey)
    async with AsyncClient(rpc_url) as client:
        resp = await client.get_balance(owner)
    lamports = int(resp.value or 0)
    return lamports / 1e9, lamports


async def fetch_spl_usdc_balance(rpc_url: str, owner_pubkey: str, usdc_mint: str) -> float:
    owner = Pubkey.from_string(owner_pubkey)
    mint = Pubkey.from_string(usdc_mint)
    opts = TokenAccountOpts(mint=mint)
    async with AsyncClient(rpc_url) as client:
        resp = await client.get_token_accounts_by_owner_json_parsed(owner, opts)
    total = 0.0
    for keyed in resp.value or []:
        parsed = keyed.account.data.parsed
        if not isinstance(parsed, dict):
            continue
        info = parsed.get("info") or {}
        token_amount = info.get("tokenAmount") or {}
        ui = token_amount.get("uiAmountString")
        if ui is not None:
            total += float(ui)
    return total


def _unwrap_pacifica_payload(body: dict[str, Any]) -> dict[str, Any]:
    if body.get("success") is True and isinstance(body.get("data"), dict):
        return body["data"]
    if isinstance(body.get("data"), dict):
        return body["data"]
    return body


async def fetch_pacifica_account_summary(
    account_pubkey: str,
    private_key_b58: str,
) -> dict[str, Any]:
    """
    Load the wallet keypair to prove the private key material is valid, then call Pacifica.

    Pacifica's public account endpoints are read-only GETs scoped by ``account``; the key is
    used for custody verification before requesting margin data.
    """
    kp = Keypair.from_base58_string(private_key_b58)
    if str(kp.pubkey()) != account_pubkey:
        raise ValueError("Decrypted private key does not match stored public key")

    base = settings.PACIFICA_API_BASE_URL.rstrip("/")
    summary_url = f"{base}/api/v1/account/summary"
    fallback_url = f"{base}/api/v1/account"
    params = {"account": account_pubkey}

    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.get(summary_url, params=params)
        if r.status_code == 404:
            r = await client.get(fallback_url, params=params)
        r.raise_for_status()
        body = r.json()

    if not isinstance(body, dict):
        raise ValueError("Unexpected Pacifica response shape")

    inner = _unwrap_pacifica_payload(body)
    available = inner.get("available_to_spend") or inner.get("available_margin_collateral")

    return {
        "available_margin_collateral": available,
        "account_equity": inner.get("account_equity"),
        "balance": inner.get("balance"),
    }
