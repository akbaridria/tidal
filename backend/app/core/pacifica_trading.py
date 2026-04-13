from __future__ import annotations

import json
import time
import uuid
from typing import Any, Optional

import base58
from solders.keypair import Keypair


def sort_json_keys(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: sort_json_keys(value[k]) for k in sorted(value.keys())}
    if isinstance(value, list):
        return [sort_json_keys(item) for item in value]
    return value


def build_signed_market_order(
    keypair: Keypair,
    symbol: str,
    amount: str,
    side: str,
    slippage_percent: str,
    reduce_only: bool = False,
    take_profit: Optional[dict[str, str]] = None,
    stop_loss: Optional[dict[str, str]] = None,
    agent_wallet: Optional[str] = None,
    expiry_window_ms: int = 30_000,
) -> dict[str, Any]:
    """
    Builds and signs a market order request for Pacifica.
    Matches the schema provided by the user.
    """
    timestamp = int(time.time() * 1000)
    
    # Base order data
    order_data: dict[str, Any] = {
        "timestamp": timestamp,
        "expiry_window": expiry_window_ms,
        "symbol": symbol,
        "amount": amount,
        "side": side, # bid/ask
        "slippage_percent": slippage_percent,
        "reduce_only": reduce_only,
        "client_order_id": str(uuid.uuid4()),
    }
    
    if take_profit:
        order_data["take_profit"] = take_profit
    if stop_loss:
        order_data["stop_loss"] = stop_loss
    if agent_wallet:
        order_data["agent_wallet"] = agent_wallet

    # Signing logic (compact sorted JSON)
    # We need to include 'account' in the message if the API expects it for the signature
    # Most Pacifica-like APIs sign the payload WITHOUT the signature field itself
    message_to_sign = {**order_data, "account": str(keypair.pubkey())}
    sorted_message = sort_json_keys(message_to_sign)
    compact_json = json.dumps(sorted_message, separators=(",", ":"))
    
    signature = keypair.sign_message(compact_json.encode("utf-8"))
    signature_b58 = base58.b58encode(bytes(signature)).decode("ascii")

    # Final payload includes everything
    return {
        "account": str(keypair.pubkey()),
        "signature": signature_b58,
        **order_data
    }
