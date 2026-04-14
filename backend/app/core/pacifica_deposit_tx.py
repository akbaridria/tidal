"""
On-chain Pacifica **Deposit** instruction.

Aligned with the official examples in
`pacifica-fi/python-sdk <https://github.com/pacifica-fi/python-sdk/tree/main/rest>`__
(particularly ``rest/deposit.py``): Anchor-style discriminator ``sha256("global:deposit")[:8]``,
borsh-compatible ``u64`` amount (6 decimals), and the same account metas including the
``__event_authority`` PDA.

Defaults follow the **mainnet** constants from that file; for devnet or other clusters, set
``SOLANA_RPC_URL``, ``PACIFICA_PROGRAM_ID``, ``PACIFICA_DEPOSIT_*``, and ``PACIFICA_DEPOSIT_MINT``.
"""

from __future__ import annotations

import hashlib
import struct
from decimal import Decimal, ROUND_DOWN
from typing import Optional

from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.transaction import Transaction
from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Confirmed
from solana.rpc.types import TxOpts
from spl.token.constants import ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID
from spl.token.instructions import get_associated_token_address

from app.core.config import settings

_SYSTEM_PROGRAM = Pubkey.from_string("11111111111111111111111111111111")


def _anchor_discriminator(name: str) -> bytes:
    """Same as ``get_discriminator`` in Pacifica's ``rest/deposit.py``."""
    return hashlib.sha256(f"global:{name}".encode()).digest()[:8]


def _amount_to_raw(amount: Decimal, decimals: int) -> int:
    scale = Decimal(10) ** decimals
    return int((amount * scale).quantize(Decimal("1"), rounding=ROUND_DOWN))


def _deposit_instruction(
    *,
    program_id: Pubkey,
    authority: Pubkey,
    user_token_ata: Pubkey,
    central_state: Pubkey,
    pacifica_vault: Pubkey,
    mint: Pubkey,
    event_authority: Pubkey,
    amount_raw: int,
) -> Instruction:
    """Instruction data matches ``deposit_layout`` (single ``u64``) in the official SDK."""
    data = _anchor_discriminator("deposit") + struct.pack("<Q", amount_raw)
    accounts = [
        AccountMeta(authority, is_signer=True, is_writable=True),
        AccountMeta(user_token_ata, is_signer=False, is_writable=True),
        AccountMeta(central_state, is_signer=False, is_writable=True),
        AccountMeta(pacifica_vault, is_signer=False, is_writable=True),
        AccountMeta(TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
        AccountMeta(ASSOCIATED_TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
        AccountMeta(mint, is_signer=False, is_writable=False),
        AccountMeta(_SYSTEM_PROGRAM, is_signer=False, is_writable=False),
        AccountMeta(event_authority, is_signer=False, is_writable=False),
        AccountMeta(program_id, is_signer=False, is_writable=False),
    ]
    return Instruction(program_id=program_id, accounts=accounts, data=data)


def _event_authority_pda(program_id: Pubkey) -> Pubkey:
    """``event_authority, _ = Pubkey.find_program_address([b"__event_authority"], PROGRAM_ID)``."""
    pda, _bump = Pubkey.find_program_address([b"__event_authority"], program_id)
    return pda


async def broadcast_pacifica_deposit(
    *,
    bot_keypair: Keypair,
    amount: Decimal,
    decimals: int = 6,
    rpc_url: Optional[str] = None,
) -> str:
    """Build, sign, and send the Pacifica ``Deposit`` instruction; returns the Solana signature."""
    program_id = Pubkey.from_string(settings.PACIFICA_PROGRAM_ID)
    mint = Pubkey.from_string(settings.PACIFICA_DEPOSIT_MINT)
    central_state = Pubkey.from_string(settings.PACIFICA_DEPOSIT_CENTRAL_STATE)
    pacifica_vault = Pubkey.from_string(settings.PACIFICA_DEPOSIT_VAULT)

    authority = bot_keypair.pubkey()
    user_token_ata = get_associated_token_address(authority, mint)
    event_authority = _event_authority_pda(program_id)

    amount_raw = _amount_to_raw(amount, decimals)
    if amount_raw <= 0:
        raise ValueError("Amount must be positive")

    ix = _deposit_instruction(
        program_id=program_id,
        authority=authority,
        user_token_ata=user_token_ata,
        central_state=central_state,
        pacifica_vault=pacifica_vault,
        mint=mint,
        event_authority=event_authority,
        amount_raw=amount_raw,
    )

    url = rpc_url or settings.SOLANA_RPC_URL
    print(f"DEBUG: Starting Pacifica deposit. RPC={url} Program={settings.PACIFICA_PROGRAM_ID}")
    async with AsyncClient(url) as client:
        try:
            bh = await client.get_latest_blockhash()
            blockhash = bh.value.blockhash
            print(f"DEBUG: Got blockhash {blockhash}")
            
            tx = Transaction.new_signed_with_payer(
                [ix],
                authority,
                [bot_keypair],
                blockhash,
            )
            opts = TxOpts(skip_preflight=False, preflight_commitment=Confirmed)
            print(f"DEBUG: Sending transaction for {amount} USDP...")
            sent = await client.send_transaction(tx, opts=opts)
            print(f"DEBUG: RPC Response: {sent}")
        except Exception as e:
            print(f"DEBUG: Exception during RPC call: {type(e).__name__}: {e!s}")
            raise

    sig = sent.value
    if sig is None:
        raise RuntimeError("Solana RPC returned no signature")
    return str(sig)
