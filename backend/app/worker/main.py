"""
ARQ worker: register `WorkerSettings` and trading task implementations.

Run: ``arq app.worker.main.WorkerSettings``
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from typing import Any
from urllib.parse import quote

import pandas as pd
import websockets
from arq.connections import RedisSettings
from sqlalchemy import select

from app.core.config import settings
from app.core.crypto import decrypt_key
from app.core.database import AsyncSessionLocal
from app.models.bot_wallet import BotWallet

# Placeholder until a real exchange feed is configured (override with EXCHANGE_WS_URL).
_DEFAULT_EXCHANGE_WS = "wss://exchange.example.com/ws"


def _candle_is_closed(msg: dict) -> bool:
    if msg.get("is_closed") is True:
        return True
    k = msg.get("k")
    if isinstance(k, dict) and k.get("x") is True:
        return True
    return False


def _extract_ohlcv(msg: dict) -> dict[str, float]:
    k = msg.get("k") if isinstance(msg.get("k"), dict) else msg
    return {
        "time": float(k.get("t", k.get("time", 0))),
        "open": float(k.get("o", k.get("open", 0))),
        "high": float(k.get("h", k.get("high", 0))),
        "low": float(k.get("l", k.get("low", 0))),
        "close": float(k.get("c", k.get("close", 0))),
        "volume": float(k.get("v", k.get("volume", 0))),
    }


async def _placeholder_trade(symbol: str, private_key_b58: str) -> None:
    _ = private_key_b58
    await asyncio.sleep(0)


async def run_trading_strategy(
    ctx: Any,
    user_id: str,
    strategy_id: str,
    symbol: str,
) -> None:
    """
    Long-running strategy loop: websocket candles → DataFrame → RSI → optional buy.
    """
    _ = ctx, strategy_id
    decrypted_private_key = None
    try:
        uid = uuid.UUID(user_id)
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(BotWallet).where(BotWallet.user_id == uid))
            wallet = result.scalar_one_or_none()

        if wallet is None:
            return

        decrypted_private_key = decrypt_key(wallet.encrypted_private_key)

        import pandas_ta as ta

        df = pd.DataFrame(columns=["time", "open", "high", "low", "close", "volume"])

        base = os.environ.get("EXCHANGE_WS_URL", _DEFAULT_EXCHANGE_WS)
        ws_url = f"{base}?symbol={quote(symbol, safe='')}"

        async with websockets.connect(ws_url) as ws:
            async for raw in ws:
                if isinstance(raw, (bytes, bytearray)):
                    raw = raw.decode()
                if not isinstance(raw, str):
                    continue
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if not isinstance(msg, dict):
                    continue
                if not _candle_is_closed(msg):
                    continue

                row = _extract_ohlcv(msg)
                df = pd.concat([df, pd.DataFrame([row])], ignore_index=True)
                df = df.iloc[-100:].copy()

                rsi_series = ta.rsi(df["close"], length=14)
                last_rsi = rsi_series.iloc[-1]
                if pd.notna(last_rsi) and float(last_rsi) < 30:
                    print("BUY SIGNAL")
                    assert decrypted_private_key is not None
                    await _placeholder_trade(symbol, decrypted_private_key)
    finally:
        del decrypted_private_key


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    functions = [run_trading_strategy]
