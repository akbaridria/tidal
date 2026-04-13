from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    value = os.environ.get(name)
    if value is not None and value != "":
        return value
    return default


@dataclass(frozen=True)
class Settings:
    PROJECT_NAME: str = _env("PROJECT_NAME", "Tidal Trading API") or "Tidal Trading API"
    DATABASE_URL: str = (
        _env(
            "DATABASE_URL",
            "postgresql+asyncpg://postgres:postgres@localhost:5432/tidal",
        )
        or "postgresql+asyncpg://postgres:postgres@localhost:5432/tidal"
    )
    REDIS_URL: str = _env("REDIS_URL", "redis://localhost:6379/0") or "redis://localhost:6379/0"
    # Default mainnet RPC to match pacifica-fi/python-sdk ``rest/deposit.py``; use devnet URL + env overrides for devnet.
    SOLANA_RPC_URL: str = _env("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com") or "https://api.mainnet-beta.solana.com"
    USDC_MINT: str = (
        _env("USDC_MINT", "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU")
        or "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
    )
    PACIFICA_API_BASE_URL: str = (
        _env("PACIFICA_API_BASE_URL", "https://test-api.pacifica.fi") or "https://test-api.pacifica.fi"
    )
    # On-chain deposit: defaults from pacifica-fi/python-sdk rest/deposit.py (mainnet).
    PACIFICA_PROGRAM_ID: str = (
        _env("PACIFICA_PROGRAM_ID", "PCFA5iYgmqK6MqPhWNKg7Yv7auX7VZ4Cx7T1eJyrAMH")
        or "PCFA5iYgmqK6MqPhWNKg7Yv7auX7VZ4Cx7T1eJyrAMH"
    )
    PACIFICA_DEPOSIT_CENTRAL_STATE: str = (
        _env("PACIFICA_DEPOSIT_CENTRAL_STATE", "9Gdmhq4Gv1LnNMp7aiS1HSVd7pNnXNMsbuXALCQRmGjY")
        or "9Gdmhq4Gv1LnNMp7aiS1HSVd7pNnXNMsbuXALCQRmGjY"
    )
    PACIFICA_DEPOSIT_VAULT: str = (
        _env("PACIFICA_DEPOSIT_VAULT", "72R843XwZxqWhsJceARQQTTbYtWy6Zw9et2YV4FpRHTa")
        or "72R843XwZxqWhsJceARQQTTbYtWy6Zw9et2YV4FpRHTa"
    )
    PACIFICA_DEPOSIT_MINT: str = (
        _env("PACIFICA_DEPOSIT_MINT", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
        or "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    )
    # WebSocket: mainnet wss://ws.pacifica.fi/ws — testnet wss://test-ws.pacifica.fi/ws (see Pacifica docs).
    PACIFICA_WS_URL: str = _env("PACIFICA_WS_URL") or ""
    # Minimum Pacifica margin (USD, same units as API balance fields) before starting live trading.
    TRADING_MIN_MARGIN_USD: str = _env("TRADING_MIN_MARGIN_USD", "10") or "10"
    SECRET_KEY: str = _env("SECRET_KEY", "your-super-secret-key-change-it-in-prod") or "your-super-secret-key-change-it-in-prod"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7 # 7 days


settings = Settings()
