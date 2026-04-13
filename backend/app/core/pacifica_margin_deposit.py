"""
Pacifica margin deposit via the on-chain **Deposit** instruction.

Implementation follows
`pacifica-fi/python-sdk <https://github.com/pacifica-fi/python-sdk/tree/main/rest>`__
(``rest/deposit.py``), using ``pacifica_deposit_tx.broadcast_pacifica_deposit``.
"""

from __future__ import annotations

from decimal import Decimal

from solders.keypair import Keypair

from app.core.pacifica_deposit_tx import broadcast_pacifica_deposit


async def deposit_usdc_to_pacifica_margin(
    *,
    rpc_url: str,
    bot_keypair: Keypair,
    amount: Decimal,
) -> str:
    """Sign and broadcast the Pacifica ``Deposit`` instruction; returns the Solana signature."""
    return await broadcast_pacifica_deposit(
        bot_keypair=bot_keypair,
        amount=amount,
        rpc_url=rpc_url,
    )
