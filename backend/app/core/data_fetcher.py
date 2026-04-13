from __future__ import annotations

import os
from typing import Any

import httpx
import pandas as pd

# Pacifica-style candles: https://docs.pacifica.fi/.../get-candle-data — override for real traffic.
_DEFAULT_PACIFICA_KLINE_URL = "https://api.pacifica.example.com/api/v1/kline"


def _unwrap_payload(payload: Any) -> Any:
    if isinstance(payload, dict):
        for key in ("data", "klines", "candles", "result", "items"):
            if key in payload:
                return payload[key]
    return payload


def _rows_from_json(payload: Any) -> list[dict[str, Any]]:
    payload = _unwrap_payload(payload)
    if not isinstance(payload, list) or len(payload) == 0:
        return []

    first = payload[0]
    if isinstance(first, dict):
        out: list[dict[str, Any]] = []
        for row in payload:
            if not isinstance(row, dict):
                continue
            out.append(
                {
                    "time": row.get("time") or row.get("t") or row.get("timestamp"),
                    "open": row.get("open") or row.get("o"),
                    "high": row.get("high") or row.get("h"),
                    "low": row.get("low") or row.get("l"),
                    "close": row.get("close") or row.get("c"),
                    "volume": row.get("volume") or row.get("v") or row.get("vol"),
                }
            )
        return out

    if isinstance(first, (list, tuple)) and len(first) >= 6:
        return [
            {
                "time": row[0],
                "open": row[1],
                "high": row[2],
                "low": row[3],
                "close": row[4],
                "volume": row[5],
            }
            for row in payload
            if isinstance(row, (list, tuple)) and len(row) >= 6
        ]

    return []


def _coerce_time_column(series: pd.Series) -> pd.Series:
    if pd.api.types.is_numeric_dtype(series):
        num = pd.to_numeric(series, errors="coerce")
        if num.notna().any() and float(num.max()) > 1e12:
            return pd.to_datetime(num, unit="ms", utc=True)
        return pd.to_datetime(num, unit="s", utc=True)
    return pd.to_datetime(series, utc=True, errors="coerce")


async def fetch_historical_klines(
    symbol: str,
    timeframe: str,
    limit: int = 1000,
) -> pd.DataFrame:
    """
    Fetch historical candlesticks from the Pacifica REST API (GET).

    Query params follow the public Pacifica pattern: ``symbol``, ``interval`` (timeframe),
    and a bounded window; a ``limit`` is sent for the placeholder server.
    """
    base_url = os.environ.get("PACIFICA_KLINE_URL", _DEFAULT_PACIFICA_KLINE_URL)
    params = {
        "symbol": symbol,
        "interval": timeframe,
        "limit": limit,
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(base_url, params=params)
        response.raise_for_status()
        payload = response.json()

    rows = _rows_from_json(payload)
    df = pd.DataFrame(rows)
    if df.empty:
        return pd.DataFrame(columns=["time", "open", "high", "low", "close", "volume"])

    df = df.tail(limit).reset_index(drop=True)

    df["time"] = _coerce_time_column(df["time"])
    for col in ("open", "high", "low", "close", "volume"):
        df[col] = pd.to_numeric(df[col], errors="coerce").astype(float)

    return df[["time", "open", "high", "low", "close", "volume"]]
