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
    """Return JSON body for ``POST /api/v1/account/withdraw`` (flat fields + signature)."""
    timestamp = int(time.time() * 1000)
    data_to_sign: dict[str, Any] = {
        "timestamp": timestamp,
        "expiry_window": expiry_window_ms,
        "type": "withdraw",
        "data": {"amount": amount_usdc},
    }
    sorted_message = sort_json_keys(data_to_sign)
    compact_json = json.dumps(sorted_message, separators=(",", ":"))
    signature = keypair.sign_message(compact_json.encode("utf-8"))
    signature_b58 = base58.b58encode(bytes(signature)).decode("ascii")

    return {
        "account": str(keypair.pubkey()),
        "signature": signature_b58,
        "timestamp": timestamp,
        "expiry_window": expiry_window_ms,
        "amount": amount_usdc,
    }
