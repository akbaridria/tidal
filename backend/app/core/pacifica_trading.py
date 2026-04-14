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
    expiry_window_ms: int = 5_000,
) -> dict[str, Any]:
    """
    Builds and signs a market order request for Pacifica following official SDK.
    """
    timestamp = int(time.time() * 1000)
    
    # 1. Signature Header
    signature_header = {
        "timestamp": timestamp,
        "expiry_window": expiry_window_ms,
        "type": "create_market_order",
    }

    # 2. Signature Payload
    signature_payload = {
        "symbol": symbol,
        "reduce_only": reduce_only,
        "amount": amount,
        "side": side,
        "slippage_percent": slippage_percent,
        "client_order_id": str(uuid.uuid4()),
    }
    
    if take_profit:
        signature_payload["take_profit"] = take_profit
    if stop_loss:
        signature_payload["stop_loss"] = stop_loss
    # Note: agent_wallet was not in the official market order example, but we keep it if present
    if agent_wallet:
        signature_payload["agent_wallet"] = agent_wallet

    # 3. Signing logic (Header flattened + Payload in 'data')
    # Following official SDK: data = { **header, "data": payload }
    message_to_sign = {
        **signature_header,
        "data": signature_payload
    }
    sorted_message = sort_json_keys(message_to_sign)
    compact_json = json.dumps(sorted_message, separators=(",", ":"))
    
    signature = keypair.sign_message(compact_json.encode("utf-8"))
    signature_b58 = base58.b58encode(bytes(signature)).decode("ascii")

    # 4. Construct Request (Flattened Header + Flattened Payload)
    return {
        "account": str(keypair.pubkey()),
        "signature": signature_b58,
        "timestamp": timestamp,
        "expiry_window": expiry_window_ms,
        **signature_payload
    }
