"""Pacifica REST signing (same rules as the official SDK: compact sorted JSON + Ed25519 + base58)."""

from __future__ import annotations

import json
import time
from typing import Any

import base58
from solders.keypair import Keypair


def sort_json_keys(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: sort_json_keys(value[k]) for k in sorted(value.keys())}
    if isinstance(value, list):
        return [sort_json_keys(item) for item in value]
    return value


def build_signed_withdraw_request(
    keypair: Keypair,
    amount_usdc: str,
    *,
    expiry_window_ms: int = 30_000,
) -> dict[str, Any]:
    """Return JSON body for ``POST /api/v1/account/withdraw`` (following official SDK)."""
    timestamp = int(time.time() * 1000)
    
    # 1. Signature Header
    signature_header = {
        "timestamp": timestamp,
        "expiry_window": expiry_window_ms,
        "type": "withdraw",
    }

    # 2. Signature Payload
    signature_payload = {
        "amount": amount_usdc,
    }

    # 3. Signing logic (Header flattened + Payload in 'data')
    combined_message = {
        **signature_header,
        "data": signature_payload
    }
    sorted_message = sort_json_keys(combined_message)
    compact_json = json.dumps(sorted_message, separators=(",", ":"))
    
    signature = keypair.sign_message(compact_json.encode("utf-8"))
    signature_b58 = base58.b58encode(bytes(signature)).decode("ascii")

    # 4. Construct Request
    return {
        "account": str(keypair.pubkey()),
        "signature": signature_b58,
        "timestamp": timestamp,
        "expiry_window": expiry_window_ms,
        **signature_payload
    }
