"""
Live trading bot initialization with Pacifica validation, multiplexed candle streams,
REST warm-up, and WebSocket fan-out to per-user strategies.

Candle WebSocket (``candle`` source) and intervals:
https://pacifica.gitbook.io/docs/api-documentation/api/websocket/subscriptions/candle.md
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Final, Optional

import httpx
import pandas as pd
import websockets

from app.core.config import settings
from app.core.crypto import decrypt_key
from app.core.wallet_balances import fetch_pacifica_account_summary

logger = logging.getLogger(__name__)

# --- Intervals supported by Pacifica K-line REST + candle WebSocket (see openapi CandleInterval + docs) ---
VALID_PACIFICA_KLINE_INTERVALS: Final[frozenset[str]] = frozenset(
    {"1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d"}
)


class TradingBotError(Exception):
    """Base error for trading bot initialization."""


class UnsupportedSymbolError(TradingBotError):
    """Requested symbol is not listed on Pacifica ``/api/v1/info``."""


class InvalidIntervalError(TradingBotError):
    """Interval is not valid for Pacifica K-line / candle WebSocket."""


class InsufficientMarginError(TradingBotError):
    """Pacifica margin below configured minimum."""


@dataclass
class StreamRuntime:
    """Internal state for a multiplexed candle stream (one WS + shared DataFrame)."""

    df: pd.DataFrame
    subscribers: list[tuple[str, dict[str, Any]]]
    indicator_cache: dict[str, Any] = field(default_factory=dict)
    last_seen_t_ms: int | None = None
    listener_task: asyncio.Task[None] | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


# Global multiplexed candle state: one DataFrame per ``{symbol}_{interval}`` stream key.
active_streams: dict[str, pd.DataFrame] = {}

# Per-stream subscribers: same key as ``active_streams``, list of (user_id, strategy_config).
stream_subscribers: dict[str, list[tuple[str, dict[str, Any]]]] = {}

_multiplex_lock = asyncio.Lock()
_runtimes: dict[str, StreamRuntime] = {}


def _pacifica_ws_url() -> str:
    if settings.PACIFICA_WS_URL:
        return settings.PACIFICA_WS_URL.rstrip("/")
    base = settings.PACIFICA_API_BASE_URL.lower()
    if "test-api" in base or "test-ws" in base:
        return "wss://test-ws.pacifica.fi/ws"
    return "wss://ws.pacifica.fi/ws"


def _normalize_symbol_for_api(symbol: str) -> str:
    """
    Pacifica REST uses base symbols (e.g. ``BTC``). Accepts ``BTC-PERP``-style names.
    """
    s = symbol.strip().upper()
    if s.endswith("-PERP"):
        s = s[: -len("-PERP")]
    return s


def stream_key(symbol: str, interval: str) -> str:
    """Key for multiplexing: preserve user-facing symbol casing for the prefix, normalize interval."""
    return f"{symbol.strip().upper()}_{interval.strip()}"


def _interval_to_ms(interval: str) -> int:
    s = interval.strip().lower()
    if len(s) < 2:
        raise InvalidIntervalError(f"Bad interval: {interval!r}")
    unit = s[-1]
    try:
        n = int(s[:-1])
    except ValueError as e:
        raise InvalidIntervalError(f"Bad interval: {interval!r}") from e
    if unit == "m":
        return n * 60_000
    if unit == "h":
        return n * 3_600_000
    if unit == "d":
        return n * 86_400_000
    raise InvalidIntervalError(f"Unsupported interval unit in {interval!r}")


def _unwrap_list_payload(body: Any) -> list[Any]:
    if isinstance(body, list):
        return body
    if isinstance(body, dict):
        if body.get("success") is True and isinstance(body.get("data"), list):
            return body["data"]
        if isinstance(body.get("data"), list):
            return body["data"]
    return []


def _sync_fetch_last_klines(
    *,
    api_base: str,
    symbol: str,
    interval: str,
    limit: int,
) -> pd.DataFrame:
    """Synchronous REST call: last ``limit`` candles (Pacifica ``GET /api/v1/kline``)."""
    end_ms = int(time.time() * 1000)
    span_ms = _interval_to_ms(interval) * limit
    start_ms = end_ms - span_ms
    url = f"{api_base.rstrip('/')}/api/v1/kline"
    params = {
        "symbol": symbol,
        "interval": interval,
        "start_time": start_ms,
        "end_time": end_ms,
    }
    with httpx.Client(timeout=60.0) as client:
        r = client.get(url, params=params)
        r.raise_for_status()
        body = r.json()

    rows_raw = _unwrap_list_payload(body)
    if not rows_raw:
        return pd.DataFrame(columns=["t_ms", "time", "open", "high", "low", "close", "volume"])

    rows: list[dict[str, Any]] = []
    for row in rows_raw:
        if not isinstance(row, dict):
            continue
        t_ms = row.get("t")
        if t_ms is None:
            continue
        t_ms = int(t_ms)
        rows.append(
            {
                "t_ms": t_ms,
                "open": float(row.get("o", row.get("open", 0))),
                "high": float(row.get("h", row.get("high", 0))),
                "low": float(row.get("l", row.get("low", 0))),
                "close": float(row.get("c", row.get("close", 0))),
                "volume": float(row.get("v", row.get("volume", 0))),
            }
        )

    df = pd.DataFrame(rows)
    if df.empty:
        return pd.DataFrame(columns=["t_ms", "time", "open", "high", "low", "close", "volume"])

    df = df.drop_duplicates(subset=["t_ms"], keep="last").sort_values("t_ms").reset_index(drop=True)
    df["time"] = pd.to_datetime(df["t_ms"], unit="ms", utc=True)
    df = df.tail(limit).reset_index(drop=True)
    return df[["t_ms", "time", "open", "high", "low", "close", "volume"]]


async def _fetch_supported_symbols() -> set[str]:
    """Query Pacifica exchange info (``GET /api/v1/info``) for tradable symbols."""
    url = f"{settings.PACIFICA_API_BASE_URL.rstrip('/')}/api/v1/info"
    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.get(url)
        r.raise_for_status()
        body = r.json()
    books = _unwrap_list_payload(body)
    out: set[str] = set()
    for item in books:
        if isinstance(item, dict) and item.get("symbol"):
            out.add(str(item["symbol"]).strip().upper())
    return out


def _parse_margin_usd(summary: dict[str, Any]) -> Decimal:
    raw = (
        summary.get("available_margin_collateral")
        or summary.get("available_to_spend")
        or summary.get("balance")
        or summary.get("account_equity")
        or "0"
    )
    try:
        return Decimal(str(raw))
    except Exception:
        return Decimal("0")


def _upsert_subscriber(subs: list[tuple[str, dict[str, Any]]], user_id: str, strategy_config: dict[str, Any]) -> None:
    for i, (uid, _) in enumerate(subs):
        if uid == user_id:
            subs[i] = (user_id, strategy_config)
            return
    subs.append((user_id, strategy_config))


def _upsert_candle_row(df: pd.DataFrame, t_ms: int, o: float, h: float, l: float, c: float, v: float) -> pd.DataFrame:
    row = {
        "t_ms": t_ms,
        "time": pd.to_datetime(t_ms, unit="ms", utc=True),
        "open": o,
        "high": h,
        "low": l,
        "close": c,
        "volume": v,
    }
    if df.empty:
        return pd.DataFrame([row])
    mask = df["t_ms"] == t_ms
    if mask.any():
        idx = df.index[mask][0]
        for k, val in row.items():
            df.at[idx, k] = val
        return df
    df = pd.concat([df, pd.DataFrame([row])], ignore_index=True)
    df = df.sort_values("t_ms").reset_index(drop=True)
    return df.iloc[-500:].reset_index(drop=True)


from app.core.strategy_evaluator import StrategyEvaluator

from app.core.pacifica_trading import build_signed_market_order
from app.models.bot_wallet import BotWallet
from app.core.database import AsyncSessionLocal
from sqlalchemy import select
from solders.keypair import Keypair

from app.models.bot_log import BotLog


async def _add_bot_log(
    user_id: str | uuid.UUID,
    level: str,
    message: str,
    strategy_id: Optional[uuid.UUID] = None,
    details: Optional[dict[str, Any]] = None,
) -> None:
    uid = uuid.UUID(str(user_id))
    async with AsyncSessionLocal() as session:
        log = BotLog(user_id=uid, strategy_id=strategy_id, level=level, message=message, details=details)
        session.add(log)
        await session.commit()


def _evaluate_user_strategy(user_id: str, strategy_config: dict[str, Any], df: pd.DataFrame, indicator_cache: dict[str, Any]) -> None:
    """Run standardized JSON logic on the shared OHLCV DataFrame."""
    if df.empty or len(df) < 5:
        return

    sid_str = strategy_config.get("strategy_id")
    sid = uuid.UUID(sid_str) if sid_str else None

    try:
        evaluator = StrategyEvaluator(df, strategy_config, indicator_cache=indicator_cache)
        signal = evaluator.evaluate()

        if signal:
            side = strategy_config.get("side", "buy").upper()
            interval = strategy_config.get("interval", "1m")
            logger.info("%s SIGNAL for user=%s sid=%s on %s interval", side, user_id, sid_str, interval)

            # Log the signal
            asyncio.create_task(_add_bot_log(
                user_id, "SIGNAL", f"{side} signal triggered on {interval} interval",
                strategy_id=sid,
                details={"symbol": strategy_config.get("symbol"), "price": float(df["close"].iloc[-1])}
            ))

            bot_config = strategy_config.get("bot_config", {})
            # Pass interval and sid to execution
            asyncio.create_task(_execute_trade(user_id, strategy_config.get("symbol"), bot_config, side, interval, strategy_id=sid))

    except Exception as e:
        logger.exception("Strategy evaluation failed user=%s sid=%s", user_id, sid_str)
        asyncio.create_task(_add_bot_log(user_id, "ERROR", f"Strategy evaluation failed: {str(e)}", strategy_id=sid))

async def _execute_trade(user_id: str, symbol_raw: str, bot_config: dict[str, Any], side: str, interval: str, strategy_id: Optional[uuid.UUID] = None) -> None:
    """
    Executes a market order on Pacifica with SL/TP/Slippage.
    """
    uid = uuid.UUID(user_id)

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(BotWallet).where(BotWallet.user_id == uid))
        wallet = result.scalar_one_or_none()

    if not wallet:
        err_msg = f"No bot wallet found for user {user_id}"
        logger.error(err_msg)
        asyncio.create_task(_add_bot_log(user_id, "ERROR", err_msg, strategy_id=strategy_id))
        return

    decrypted = decrypt_key(wallet.encrypted_private_key)
    kp = Keypair.from_base58_string(decrypted)

    # 1. Normalize symbol
    symbol = _normalize_symbol_for_api(symbol_raw)

    # 2. CHECK FOR OPEN POSITIONS
    try:
        base = settings.PACIFICA_API_BASE_URL.rstrip("/")
        pos_url = f"{base}/api/v1/positions"
        params = {"account": wallet.public_key}
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(pos_url, params=params)
            resp.raise_for_status()
            positions = _unwrap_list_payload(resp.json())

            for p in positions:
                if p.get("symbol") == symbol:
                    amt = float(p.get("amount", 0))
                    if abs(amt) > 0:
                        msg = f"User {user_id} already has an open position for {symbol}. Skipping trade."
                        logger.info(msg)
                        asyncio.create_task(_add_bot_log(user_id, "INFO", msg, strategy_id=strategy_id))
                        return
    except Exception as e:
        err_msg = f"Failed to check positions for user {user_id}: {str(e)}"
        logger.error(err_msg)
        asyncio.create_task(_add_bot_log(user_id, "ERROR", err_msg, strategy_id=strategy_id))
        return

    # 3. Get current price
    skey = stream_key(symbol_raw, interval)
    df = active_streams.get(skey)
    if df is None or df.empty:
        err_msg = f"No price data for {skey}"
        logger.error(err_msg)
        asyncio.create_task(_add_bot_log(user_id, "ERROR", err_msg, strategy_id=strategy_id))
        return

    current_price = float(df["close"].iloc[-1])

    # 4. Order calculation
    size_usd = float(bot_config.get("size_usd", 100))
    amount = str(round(size_usd / current_price, 4))
    slippage = str(bot_config.get("max_slippage_pct", 0.5))
    api_side = "bid" if side.lower() == "buy" else "ask"

    sl_pct = float(bot_config.get("stop_loss_pct", 2.0))
    tp_pct = float(bot_config.get("take_profit_pct", 5.0))

    take_profit = None
    if tp_pct > 0:
        tp_price = current_price * (1 + tp_pct/100) if api_side == "bid" else current_price * (1 - tp_pct/100)
        take_profit = {"stop_price": str(int(round(tp_price))), "client_order_id": str(uuid.uuid4())}

    stop_loss = None
    if sl_pct > 0:
        sl_price = current_price * (1 - sl_pct/100) if api_side == "bid" else current_price * (1 + sl_pct/100)
        stop_loss = {"stop_price": str(int(round(sl_price))), "client_order_id": str(uuid.uuid4())}

    payload = build_signed_market_order(
        keypair=kp, symbol=symbol, amount=amount, side=api_side,
        slippage_percent=slippage, take_profit=take_profit, stop_loss=stop_loss
    )
    logger.info("DEBUG: Order Payload for user %s: %s", user_id, payload)

    # 5. Send to API
    base = settings.PACIFICA_API_BASE_URL.rstrip("/")
    url = f"{base}/api/v1/orders/create_market"

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            r = await client.post(url, json=payload)
            if r.status_code != 200:
                logger.error("DEBUG: Pacifica Order Error Response: %d %s", r.status_code, r.text)
            r.raise_for_status()
            res_json = r.json()
            logger.info("Order executed successfully for sid=%s: %s", strategy_id, res_json)
            asyncio.create_task(_add_bot_log(user_id, "TRADE", f"Executed {side} order for {symbol}", strategy_id=strategy_id, details=res_json))
        except Exception as e:
            err_details = ""
            if isinstance(e, httpx.HTTPStatusError):
                err_details = f" | Response: {e.response.text}"
            err_msg = f"Order failed: {str(e)}{err_details}"
            logger.error(err_msg)
            asyncio.create_task(_add_bot_log(user_id, "ERROR", err_msg, strategy_id=strategy_id))

    del decrypted


async def _evaluate_all_subscribers(key: str) -> None:
    rt = _runtimes.get(key)
    if rt is None:
        return
    async with rt.lock:
        df = rt.df.copy()
        subs = list(rt.subscribers)
        # Task 3: Clear indicator cache on each new evaluation (new candle)
        rt.indicator_cache.clear()
        indicator_cache = rt.indicator_cache # shared among all subscribers for this stream

    for uid, cfg in subs:
        try:
            _evaluate_user_strategy(uid, cfg, df, indicator_cache)
        except Exception:
            logger.exception("Strategy evaluation failed user=%s stream=%s", uid, key)


def _candle_payload_to_row(data: dict[str, Any]) -> tuple[int, float, float, float, float, float] | None:
    t = data.get("t")
    if t is None:
        return None
    t_ms = int(t)
    return (
        t_ms,
        float(data.get("o", 0)),
        float(data.get("h", 0)),
        float(data.get("l", 0)),
        float(data.get("c", 0)),
        float(data.get("v", 0)),
    )


async def _ping_loop(ws: Any) -> None:
    try:
        while True:
            await asyncio.sleep(30)
            await ws.send(json.dumps({"method": "ping"}))
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.debug("ping loop exit", exc_info=True)


async def _run_candle_listener(
    *,
    key: str,
    api_symbol: str,
    interval: str,
) -> None:
    ws_url = _pacifica_ws_url()
    sub = {
        "method": "subscribe",
        "params": {"source": "candle", "symbol": api_symbol, "interval": interval},
    }
    
    # Task 4: Resilient WebSocket Reconnections
    attempts = 0
    while True:
        try:
            async with websockets.connect(ws_url, ping_interval=None, ping_timeout=None) as ws:
                attempts = 0 # Reset attempts on successful connection
                await ws.send(json.dumps(sub))
                ping_task = asyncio.create_task(_ping_loop(ws))
                try:
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
                        if msg.get("channel") == "pong":
                            continue
                        if msg.get("channel") != "candle":
                            continue
                        data = msg.get("data")
                        if not isinstance(data, dict):
                            continue
                        parsed = _candle_payload_to_row(data)
                        if parsed is None:
                            continue
                        t_ms, o, h, l, c, v = parsed

                        rt = _runtimes.get(key)
                        if rt is None:
                            # Stream was stopped while we were listening
                            return

                        async with rt.lock:
                            prior = rt.last_seen_t_ms
                            rt.df = _upsert_candle_row(rt.df, t_ms, o, h, l, c, v)
                            active_streams[key] = rt.df
                            should_eval = prior is not None and t_ms != prior
                            rt.last_seen_t_ms = t_ms
                            if should_eval:
                                rt.indicator_cache.clear() # Clear cache on new candle

                        if should_eval:
                            await _evaluate_all_subscribers(key)
                finally:
                    ping_task.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await ping_task
        except asyncio.CancelledError:
            # Task was cancelled (e.g. last subscriber left)
            raise
        except Exception as e:
            attempts += 1
            delay = min(2 ** attempts, 60)
            logger.exception("Candle WebSocket failed stream=%s. Retrying in %ds... Error: %s", key, delay, str(e))
            await asyncio.sleep(delay)


async def stop_bot_for_user(
    user_id: str | uuid.UUID,
    symbol_raw: str,
    interval: str,
) -> dict[str, Any]:
    """
    Stops a bot for a specific user and stream.
    If no subscribers left, cancels the WebSocket listener.
    """
    uid_str = str(user_id)
    skey = stream_key(symbol_raw, interval)
    
    async with _multiplex_lock:
        if skey not in _runtimes:
            return {"ok": False, "message": "Stream not active"}
            
        rt = _runtimes[skey]
        # Filter out this user
        original_count = len(rt.subscribers)
        rt.subscribers = [(uid, cfg) for uid, cfg in rt.subscribers if uid != uid_str]
        stream_subscribers[skey] = rt.subscribers
        
        if len(rt.subscribers) == 0:
            # Clean up task and memory
            if rt.listener_task:
                rt.listener_task.cancel()
            
            _runtimes.pop(skey, None)
            active_streams.pop(skey, None)
            stream_subscribers.pop(skey, None)
            
            return {
                "ok": True,
                "message": f"User stopped. Last subscriber, closed stream {skey}"
            }
            
        return {
            "ok": True,
            "message": f"User stopped. {len(rt.subscribers)} subscribers remaining for {skey}"
        }


async def initialize_bot_for_user(
    user_id: str | uuid.UUID,
    strategy_config: dict[str, Any],
) -> dict[str, Any]:
    """
    Full checklist before any WebSocket connects: markets, interval, margin; then multiplex,
    warm-up (sync REST klines), and start the listener when this is the first subscriber.

    ``strategy_config`` must include ``symbol`` and ``interval`` (or ``timeframe`` alias).
    """
    uid_str = str(user_id)
    symbol_raw = strategy_config.get("symbol")
    interval = strategy_config.get("interval") or strategy_config.get("timeframe")
    if not symbol_raw or not interval:
        raise TradingBotError("strategy_config must include 'symbol' and 'interval' (or 'timeframe')")

    if not isinstance(symbol_raw, str) or not isinstance(interval, str):
        raise TradingBotError("symbol and interval must be strings")

    interval = interval.strip()
    api_symbol = _normalize_symbol_for_api(symbol_raw)
    skey = stream_key(symbol_raw, interval)

    if interval not in VALID_PACIFICA_KLINE_INTERVALS:
        raise InvalidIntervalError(
            f"Invalid interval {interval!r}; valid: {sorted(VALID_PACIFICA_KLINE_INTERVALS)}",
        )

    supported = await _fetch_supported_symbols()
    if api_symbol not in supported:
        raise UnsupportedSymbolError(
            f"Symbol {symbol_raw!r} (normalized {api_symbol!r}) is not active on Pacifica",
        )

    from sqlalchemy import select

    from app.core.database import AsyncSessionLocal
    from app.models.bot_wallet import BotWallet

    uid = uuid.UUID(uid_str) if isinstance(user_id, str) else user_id
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(BotWallet).where(BotWallet.user_id == uid))
        wallet = result.scalar_one_or_none()
    if wallet is None:
        raise TradingBotError("No bot wallet found for user")

    private_key = decrypt_key(wallet.encrypted_private_key)
    try:
        summary = await fetch_pacifica_account_summary(wallet.public_key, private_key)
    finally:
        del private_key
    margin = _parse_margin_usd(summary)
    min_margin = Decimal(str(settings.TRADING_MIN_MARGIN_USD))
    if margin < min_margin:
        raise InsufficientMarginError(
            f"Insufficient Margin: available {margin} < minimum {min_margin} USD",
        )

    async with _multiplex_lock:
        if skey in active_streams and skey in _runtimes:
            _upsert_subscriber(stream_subscribers[skey], uid_str, strategy_config)
            _runtimes[skey].subscribers = stream_subscribers[skey]
            return {
                "ok": True,
                "stream_key": skey,
                "multiplexed": True,
                "message": "Joined existing candle stream",
            }

        df = await asyncio.to_thread(
            _sync_fetch_last_klines,
            api_base=settings.PACIFICA_API_BASE_URL,
            symbol=api_symbol,
            interval=interval,
            limit=100,
        )
        if df.empty:
            raise TradingBotError("Warm-up kline fetch returned no rows; cannot start stream")

        subs: list[tuple[str, dict[str, Any]]] = []
        _upsert_subscriber(subs, uid_str, strategy_config)
        stream_subscribers[skey] = subs

        last_t = int(df["t_ms"].iloc[-1])
        rt = StreamRuntime(
            df=df,
            subscribers=subs,
            last_seen_t_ms=last_t,
        )
        _runtimes[skey] = rt
        active_streams[skey] = df

        rt.listener_task = asyncio.create_task(
            _run_candle_listener(key=skey, api_symbol=api_symbol, interval=interval),
            name=f"pacifica-candle-{skey}",
        )

    return {
        "ok": True,
        "stream_key": skey,
        "multiplexed": False,
        "rows_warmed": len(df),
        "message": "Started new candle stream and WebSocket listener",
    }
