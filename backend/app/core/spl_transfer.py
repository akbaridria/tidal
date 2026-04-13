"""Async SPL Token (USDC) transfers via Solana RPC."""

from __future__ import annotations

from decimal import Decimal, ROUND_DOWN

from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.transaction import Transaction
from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Confirmed
from solana.rpc.types import TxOpts
from spl.token.constants import TOKEN_PROGRAM_ID
from spl.token.instructions import (
    TransferCheckedParams,
    create_idempotent_associated_token_account,
    get_associated_token_address,
    transfer_checked,
)


def _to_base_units(amount: Decimal, decimals: int) -> int:
    scale = Decimal(10) ** decimals
    return int((amount * scale).quantize(Decimal("1"), rounding=ROUND_DOWN))


async def transfer_usdc_to_destination(
    *,
    rpc_url: str,
    mint: str,
    bot_keypair: Keypair,
    destination_owner_address: str,
    amount: Decimal,
    decimals: int = 6,
) -> str:
    """
    Transfer USDC from the bot wallet's ATA to the recipient's ATA (create dest ATA idempotently).
    Returns base58 transaction signature.
    """
    mint_pk = Pubkey.from_string(mint)
    dest_owner = Pubkey.from_string(destination_owner_address)
    bot_pk = bot_keypair.pubkey()

    source_ata = get_associated_token_address(bot_pk, mint_pk)
    dest_ata = get_associated_token_address(dest_owner, mint_pk)

    amount_raw = _to_base_units(amount, decimals)
    if amount_raw <= 0:
        raise ValueError("Amount must be positive")

    ix_ata = create_idempotent_associated_token_account(bot_pk, dest_owner, mint_pk)
    ix_xfer = transfer_checked(
        TransferCheckedParams(
            program_id=TOKEN_PROGRAM_ID,
            source=source_ata,
            mint=mint_pk,
            dest=dest_ata,
            owner=bot_pk,
            amount=amount_raw,
            decimals=decimals,
            signers=[],
        )
    )

    async with AsyncClient(rpc_url) as client:
        bh = await client.get_latest_blockhash()
        blockhash = bh.value.blockhash
        tx = Transaction.new_signed_with_payer(
            [ix_ata, ix_xfer],
            bot_pk,
            [bot_keypair],
            blockhash,
        )
        opts = TxOpts(skip_preflight=False, preflight_commitment=Confirmed)
        sent = await client.send_transaction(tx, opts=opts)

    sig = sent.value
    if sig is None:
        raise RuntimeError("Solana RPC returned no signature")
    return str(sig)


async def transfer_usdc_to_deposit_token_account(
    *,
    rpc_url: str,
    mint: str,
    owner_keypair: Keypair,
    destination_token_account: str,
    amount: Decimal,
    decimals: int = 6,
) -> str:
    """
    Transfer USDC from the owner's ATA to an existing destination token account (e.g. Pacifica vault).

    Does not create accounts; the destination must already be a valid USDC token account for ``mint``.
    """
    mint_pk = Pubkey.from_string(mint)
    bot_pk = owner_keypair.pubkey()
    source_ata = get_associated_token_address(bot_pk, mint_pk)
    dest_ata = Pubkey.from_string(destination_token_account)

    amount_raw = _to_base_units(amount, decimals)
    if amount_raw <= 0:
        raise ValueError("Amount must be positive")

    ix_xfer = transfer_checked(
        TransferCheckedParams(
            program_id=TOKEN_PROGRAM_ID,
            source=source_ata,
            mint=mint_pk,
            dest=dest_ata,
            owner=bot_pk,
            amount=amount_raw,
            decimals=decimals,
            signers=[],
        )
    )

    async with AsyncClient(rpc_url) as client:
        bh = await client.get_latest_blockhash()
        blockhash = bh.value.blockhash
        tx = Transaction.new_signed_with_payer(
            [ix_xfer],
            bot_pk,
            [owner_keypair],
            blockhash,
        )
        opts = TxOpts(skip_preflight=False, preflight_commitment=Confirmed)
        sent = await client.send_transaction(tx, opts=opts)

    sig = sent.value
    if sig is None:
        raise RuntimeError("Solana RPC returned no signature")
    return str(sig)
