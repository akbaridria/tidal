import time
import httpx
from typing import Dict, Any

from solders.keypair import Keypair
from app.core.config import settings
from app.core.pacifica_signing import sort_json_keys
import json
import base58

def sign_message(header: Dict[str, Any], payload: Dict[str, Any], keypair: Keypair) -> tuple[str, str]:
    if "type" not in header or "timestamp" not in header or "expiry_window" not in header:
        raise ValueError("Header must have type, timestamp, and expiry_window")
    data = {**header, "data": payload}
    message = sort_json_keys(data)
    compact_json = json.dumps(message, separators=(",", ":"))
    signature = keypair.sign_message(compact_json.encode("utf-8"))
    return compact_json, base58.b58encode(bytes(signature)).decode("ascii")

async def create_subaccount(main_keypair: Keypair, sub_keypair: Keypair) -> None:
    timestamp = int(time.time() * 1_000)
    expiry_window = 5_000
    main_public_key = str(main_keypair.pubkey())
    sub_public_key = str(sub_keypair.pubkey())

    subaccount_signature_header = {
        "timestamp": timestamp,
        "expiry_window": expiry_window,
        "type": "subaccount_initiate",
    }
    sub_payload = {"account": main_public_key}
    _, subaccount_signature = sign_message(subaccount_signature_header, sub_payload, sub_keypair)

    main_account_signature_header = {
        "timestamp": timestamp,
        "expiry_window": expiry_window,
        "type": "subaccount_confirm",
    }
    main_payload = {"signature": subaccount_signature}
    _, main_signature = sign_message(main_account_signature_header, main_payload, main_keypair)

    request = {
        "main_account": main_public_key,
        "subaccount": sub_public_key,
        "main_signature": main_signature,
        "sub_signature": subaccount_signature,
        "timestamp": timestamp,
        "expiry_window": expiry_window,
    }

    base = settings.PACIFICA_API_BASE_URL.rstrip("/")
    url = f"{base}/api/v1/account/subaccount/create"
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(url, json=request)
        if response.status_code != 200:
            print(f"DEBUG: create_subaccount failed {response.text}")
        response.raise_for_status()

async def transfer_subaccount_fund(from_keypair: Keypair, to_public_key: str, amount: str) -> None:
    timestamp = int(time.time() * 1_000)
    expiry_window = 5_000
    from_public_key = str(from_keypair.pubkey())

    signature_header = {
        "timestamp": timestamp,
        "expiry_window": expiry_window,
        "type": "transfer_funds",
    }
    signature_payload = {
        "to_account": to_public_key,
        "amount": amount,
    }

    _, signature = sign_message(signature_header, signature_payload, from_keypair)

    request_header = {
        "account": from_public_key,
        "signature": signature,
        "timestamp": signature_header["timestamp"],
        "expiry_window": signature_header["expiry_window"],
    }
    request = {**request_header, **signature_payload}

    base = settings.PACIFICA_API_BASE_URL.rstrip("/")
    url = f"{base}/api/v1/account/subaccount/transfer"
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(url, json=request)
        if response.status_code != 200:
            error_data = response.text
            print(f"DEBUG: transfer_subaccount_fund failed {error_data}")
            raise Exception(f"Pacifica API Error ({response.status_code}): {error_data}")
        response.raise_for_status()

        response.raise_for_status()

# Simple cache for list_subaccounts to avoid redundant hits on simultaneous bot detail requests
_subaccounts_cache = {} # main_pubkey -> (timestamp, data)
SUBACCOUNT_CACHE_TTL = 5.0 # seconds

async def list_subaccounts(main_keypair: Keypair) -> list[Dict[str, Any]]:
    main_public_key = str(main_keypair.pubkey())
    now = time.time()
    
    # Check cache
    if main_public_key in _subaccounts_cache:
        ts, data = _subaccounts_cache[main_public_key]
        if now - ts < SUBACCOUNT_CACHE_TTL:
            return data

    timestamp = int(now * 1_000)
    expiry_window = 5_000
    main_public_key = str(main_keypair.pubkey())

    signature_header = {
        "timestamp": timestamp,
        "expiry_window": expiry_window,
        "type": "list_subaccounts",
    }
    signature_payload = {}
    
    _, signature = sign_message(signature_header, signature_payload, main_keypair)

    request = {
        "account": main_public_key,
        "signature": signature,
        "timestamp": timestamp,
        "expiry_window": expiry_window,
    }

    base = settings.PACIFICA_API_BASE_URL.rstrip("/")
    url = f"{base}/api/v1/account/subaccount/list"
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(url, json=request)
        if response.status_code != 200:
            print(f"DEBUG: list_subaccounts failed {response.text}")
        response.raise_for_status()
        data = response.json().get("data", {}).get("subaccounts", [])
        
        # Update cache
        _subaccounts_cache[main_public_key] = (time.time(), data)
        
        return data
