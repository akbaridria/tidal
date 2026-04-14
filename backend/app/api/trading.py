from __future__ import annotations

import uuid
from typing import Any, Optional

from arq.connections import ArqRedis
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.api.deps import get_arq_pool, get_db
from app.core.auth import get_current_user
from app.core.backtester import run_vectorbt_backtest
from app.core.data_fetcher import fetch_historical_klines
from app.models.strategy import Strategy
from app.models.bot_log import BotLog
from app.models.user import User


router = APIRouter(tags=["trading"])


from app.worker.trading_manager import (
    initialize_bot_for_user, 
    stop_bot_for_user,
    _execute_trade  # for manual testing
)


@router.get("/logs")
async def get_bot_logs(
    current_user: User = Depends(get_current_user),
    strategy_id: Optional[uuid.UUID] = None,
    limit: int = 50,
    session: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    query = select(BotLog).where(BotLog.user_id == current_user.id)
    if strategy_id:
        query = query.where(BotLog.strategy_id == strategy_id)
    
    query = query.order_by(BotLog.created_at.desc()).limit(limit)
    result = await session.execute(query)
    logs = result.scalars().all()
    
    return [
        {
            "id": str(log.id),
            "level": log.level,
            "message": log.message,
            "details": log.details,
            "created_at": log.created_at.isoformat(),
            "strategy_id": str(log.strategy_id) if log.strategy_id else None
        }
        for log in logs
    ]


class StopBotBody(BaseModel):
    strategy_id: uuid.UUID = Field(..., description="Strategy to stop")


@router.post("/stop-bot")
async def stop_bot(
    body: StopBotBody,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    result = await session.execute(
        select(Strategy).where(
            Strategy.id == body.strategy_id,
            Strategy.user_id == current_user.id
        )
    )
    strategy = result.scalar_one_or_none()
    if strategy is None:
        raise HTTPException(status_code=404, detail="Strategy not found")

    try:
        res = await stop_bot_for_user(
            current_user.id,
            strategy.trading_pair,
            strategy.config.get("interval", "1m")
        )
        strategy.is_active = False
        
        session.add(
            BotLog(
                user_id=current_user.id,
                strategy_id=strategy.id,
                level="INFO",
                message="Bot stopped manually"
            )
        )
        
        await session.commit()
        
        # If the DB update succeeds, we want the client to treat it as a success, 
        # even if the in-memory stream was already gone.
        if not res.get("ok"):
            res["ok"] = True
            res["message"] = f"Bot stopped (Note: {res.get('message')})"
            
        return res
    except Exception as e:
        logger.exception("Failed to stop bot")
        raise HTTPException(status_code=400, detail=str(e))


class StrategyCondition(BaseModel):
    operator: str = Field(..., description="Logical operator (AND, OR) or Comparison (> , < , crossover, etc.)")
    indicator: Optional[str] = Field(None, description="Indicator name (RSI, MACD, etc.)")
    params: Optional[dict[str, Any]] = Field(None, description="Indicator parameters")
    field: Optional[str] = Field(None, description="Indicator field (e.g. histogram for MACD)")
    value: Optional[float] = Field(None, description="Constant value for comparison")
    compare: Optional["StrategyCondition"] = Field(None, description="Nested condition for comparison")
    expressions: Optional[list["StrategyCondition"]] = Field(None, description="Nested expressions for AND/OR")


StrategyCondition.model_rebuild()


class BacktestBody(BaseModel):
    symbol: str = Field(..., description="Trading pair symbol")
    timeframe: str = Field(..., description="Bar interval (e.g. 1m, 1h)")
    strategy_config: dict[str, Any] = Field(..., description="Strategy parameters (standardized JSON)")


@router.post("/backtest")
async def run_backtest(
    body: BacktestBody,
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    df = await fetch_historical_klines(body.symbol, body.timeframe)
    return await run_in_threadpool(run_vectorbt_backtest, df, body.strategy_config)


class BotConfig(BaseModel):
    stop_loss_pct: Optional[float] = Field(2.0, description="Stop loss percentage")
    take_profit_pct: Optional[float] = Field(5.0, description="Take profit percentage")
    max_slippage_pct: Optional[float] = Field(0.5, description="Max slippage percentage")
    size_usd: float = Field(100.0, description="Order size in USD")
    leverage: int = Field(10, description="Leverage multiplier")
    margin_mode: str = Field("ISOLATED", description="Margin mode (ISOLATED or CROSS)")


class WithdrawResponse(BaseModel):
    ok: bool
    amount_withdrawn: str
    message: str


@router.post("/strategies/{strategy_id}/withdraw", response_model=WithdrawResponse)
async def withdraw_subaccount_to_bot(
    strategy_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> WithdrawResponse:
    from app.models.bot_wallet import BotWallet
    from app.core.pacifica_subaccount import transfer_subaccount_fund
    from app.core.wallet_balances import fetch_pacifica_account_summary
    from app.core.crypto import decrypt_key
    from solders.keypair import Keypair
    import logging
    logger = logging.getLogger(__name__)

    # 1. Fetch Strategy
    result = await session.execute(
        select(Strategy).where(
            Strategy.id == strategy_id,
            Strategy.user_id == current_user.id
        )
    )
    strategy = result.scalar_one_or_none()
    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")

    if strategy.is_active:
        raise HTTPException(status_code=400, detail="Cannot withdraw from an active strategy")

    if not strategy.subaccount_pubkey or not strategy.subaccount_encrypted_pk:
        raise HTTPException(status_code=400, detail="Strategy has no active subaccount")

    # 2. Fetch Bot Wallet
    wallet_result = await session.execute(select(BotWallet).where(BotWallet.user_id == current_user.id))
    bot_wallet = wallet_result.scalar_one_or_none()
    if not bot_wallet:
        raise HTTPException(status_code=400, detail="No bot wallet found")
        
    main_pubkey = bot_wallet.public_key

    # 3. Check Subaccount Balance via list_subaccounts to match UI exactly
    from app.core.pacifica_subaccount import list_subaccounts
    main_kp = Keypair.from_base58_string(decrypt_key(bot_wallet.encrypted_private_key))
    
    subs = await list_subaccounts(main_kp)
    sub_data = next((s for s in subs if s.get("address") == strategy.subaccount_pubkey), None)
    
    available_str = sub_data.get("balance", "0") if sub_data else "0"
    
    if float(available_str) <= 0.01:
        # Check if there is pending balance
        pending_str = sub_data.get("pending_balance", "0") if sub_data else "0"
        if float(pending_str) > 0.01:
            return WithdrawResponse(ok=False, amount_withdrawn="0", message=f"Funds ({pending_str}) are currently pending settlement. Please wait.")
        return WithdrawResponse(ok=True, amount_withdrawn="0.0", message="No funds available to withdraw")

    sub_kp = Keypair.from_base58_string(decrypt_key(strategy.subaccount_encrypted_pk))
    
    # Round down to 6 decimals to avoid precision errors (USDC standard)
    import math
    f_val = float(available_str)
    rounded_down = math.floor(f_val * 1_000_000) / 1_000_000
    amount_str = f"{rounded_down:.6f}"

    # 4. Transfer to Main Account
    try:
        await transfer_subaccount_fund(sub_kp, main_pubkey, amount_str)
        
        # 5. Log Result
        session.add(
            BotLog(
                user_id=current_user.id,
                strategy_id=strategy.id,
                level="INFO",
                message=f"Swept {amount_str} USDC from subaccount to Bot Wallet"
            )
        )
        # Clear subaccount so it won't be used again without funding? 
        # Actually it's fine to leave it attached so they can restart with/without new margin.
        
        await session.commit()
    except Exception as e:
        logger.error(f"Failed to withdraw from subaccount: {e}")
        raise HTTPException(status_code=400, detail=f"Withdrawal failed: {e}")

    return WithdrawResponse(ok=True, amount_withdrawn=amount_str, message="Funds withdrawn to Bot Wallet")


class DepositBody(BaseModel):
    amount: float = Field(..., gt=0.01)

class DepositResponse(BaseModel):
    ok: bool
    amount_deposited: str
    message: str

@router.post("/strategies/{strategy_id}/deposit", response_model=DepositResponse)
async def deposit_subaccount_funds(
    strategy_id: uuid.UUID,
    body: DepositBody,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    from app.models.strategy import Strategy
    from app.models.bot_wallet import BotWallet
    from app.models.bot_log import BotLog
    from app.core.pacifica_subaccount import transfer_subaccount_fund
    from app.core.crypto import decrypt_key
    from solders.keypair import Keypair
    import httpx

    # 1. Fetch Strategy
    result = await session.execute(select(Strategy).where(Strategy.id == strategy_id, Strategy.user_id == current_user.id))
    strategy = result.scalar_one_or_none()
    if not strategy or not strategy.subaccount_pubkey:
        raise HTTPException(status_code=404, detail="Subaccount-enabled strategy not found")

    # 2. Fetch Bot Wallet
    wallet_result = await session.execute(select(BotWallet).where(BotWallet.user_id == current_user.id))
    bot_wallet = wallet_result.scalar_one_or_none()
    if not bot_wallet or not bot_wallet.encrypted_private_key:
        raise HTTPException(status_code=400, detail="Bot wallet not found")

    main_kp = Keypair.from_base58_string(decrypt_key(bot_wallet.encrypted_private_key))
    
    # Round to 6 decimals for USDC standard
    f_val = float(body.amount)
    amount_str = f"{f_val:.6f}"

    # 3. Transfer from Main Account to Subaccount
    try:
        await transfer_subaccount_fund(main_kp, strategy.subaccount_pubkey, amount_str)
    except httpx.HTTPStatusError as e:
        status_msg = e.response.json().get("error", str(e))
        return DepositResponse(ok=False, amount_deposited="0", message=f"Transfer failed: {status_msg}")
    except Exception as e:
        return DepositResponse(ok=False, amount_deposited="0", message=f"Transfer failed: {str(e)}")

    # 4. Log
    log = BotLog(
        user_id=current_user.id,
        strategy_id=strategy.id,
        level="INFO",
        message=f"Supplied {amount_str} USDC from main margin to subaccount."
    )
    session.add(log)
    await session.commit()
    
    return DepositResponse(ok=True, amount_deposited=amount_str, message="Funds successfully deposited to subaccount")

class CreateStrategyBody(BaseModel):
    trading_pair: str
    side: str = Field("buy", description="Action to take: buy or sell")
    name: Optional[str] = None
    config: dict[str, Any] = Field(..., description="Standardized strategy JSON")
    bot_config: Optional[BotConfig] = Field(default_factory=BotConfig, description="Bot configuration")


class CreateStrategyResponse(BaseModel):
    id: uuid.UUID
    message: str = "Strategy Created"


from app.core.strategy_presets import STRATEGY_PRESETS


@router.get("/strategies/presets")
async def list_presets(
    current_user: User = Depends(get_current_user)
) -> list[dict[str, Any]]:
    return STRATEGY_PRESETS


class CreateFromPresetBody(BaseModel):
    trading_pair: str
    preset_id: str
    interval: str = Field("1h", description="Candle interval (e.g. 1m, 1h)")
    bot_config: Optional[BotConfig] = Field(default_factory=BotConfig)


@router.post("/strategies/from-preset", response_model=CreateStrategyResponse)
async def create_from_preset(
    body: CreateFromPresetBody,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> CreateStrategyResponse:
    preset = next((p for p in STRATEGY_PRESETS if p["id"] == body.preset_id), None)
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    
    strategy = Strategy(
        user_id=current_user.id,
        trading_pair=body.trading_pair,
        name=preset["name"],
        config={**preset["config"], "interval": body.interval},
        bot_config=body.bot_config.dict() if body.bot_config else {},
    )
    session.add(strategy)
    await session.commit()
    await session.refresh(strategy)
    return CreateStrategyResponse(id=strategy.id)


@router.post("/strategies", response_model=CreateStrategyResponse)
async def create_strategy(
    body: CreateStrategyBody,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> CreateStrategyResponse:
    strategy = Strategy(
        user_id=current_user.id,
        trading_pair=body.trading_pair,
        name=body.name,
        config={**body.config, "side": body.side},
        bot_config=body.bot_config.dict() if body.bot_config else {},
    )
    session.add(strategy)
    await session.commit()
    await session.refresh(strategy)
@router.get("/strategies")
async def list_strategies(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    result = await session.execute(select(Strategy).where(Strategy.user_id == current_user.id))
    strategies = result.scalars().all()
    
    from app.models.bot_wallet import BotWallet
    # NOTE: Expensive subaccount margin fetching removed from list API to keep it snappy.
    # Individual bot cards will call GET /strategies/{id} to fetch their own margin.
    
    return [
        {
            "id": str(s.id),
            "name": s.name,
            "trading_pair": s.trading_pair,
            "is_active": s.is_active,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in strategies
    ]


@router.get("/strategies/{strategy_id}")
async def get_strategy(
    strategy_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    result = await session.execute(
        select(Strategy).where(
            Strategy.id == strategy_id,
            Strategy.user_id == current_user.id
        )
    )
    strategy = result.scalar_one_or_none()
    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")
    
    from app.models.bot_wallet import BotWallet
    from app.core.pacifica_subaccount import list_subaccounts
    from app.core.crypto import decrypt_key
    from solders.keypair import Keypair
    
    allocated_margin = strategy.bot_config.get("size_usd", 0.0)
    pending_margin = 0.0
    if strategy.subaccount_pubkey:
        try:
            wallet_res = await session.execute(select(BotWallet).where(BotWallet.user_id == current_user.id))
            wallet = wallet_res.scalar_one_or_none()
            if wallet:
                main_kp = Keypair.from_base58_string(decrypt_key(wallet.encrypted_private_key))
                subs = await list_subaccounts(main_kp)
                for sub in subs:
                    if sub.get("address") == strategy.subaccount_pubkey:
                        allocated_margin = float(sub.get("balance") or 0)
                        pending_margin = float(sub.get("pending_balance") or 0)
                        break
        except Exception:
            pass
    
    return {
        "id": str(strategy.id),
        "name": strategy.name,
        "trading_pair": strategy.trading_pair,
        "config": strategy.config,
        "bot_config": strategy.bot_config,
        "created_at": strategy.created_at.isoformat() if strategy.created_at else None,
        "is_active": strategy.is_active,
        "allocated_margin": allocated_margin,
        "pending_margin": pending_margin,
    }


class UpdateStrategyBody(BaseModel):
    name: Optional[str] = None
    config: Optional[dict[str, Any]] = None
    bot_config: Optional[BotConfig] = None


@router.put("/strategies/{strategy_id}")
async def update_strategy(
    strategy_id: uuid.UUID,
    body: UpdateStrategyBody,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    result = await session.execute(
        select(Strategy).where(
            Strategy.id == strategy_id,
            Strategy.user_id == current_user.id
        )
    )
    strategy = result.scalar_one_or_none()
    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")
    
    if body.name is not None:
        strategy.name = body.name
    if body.config is not None:
        strategy.config = body.config
    if body.bot_config is not None:
        strategy.bot_config = body.bot_config.dict()
    
    await session.commit()
    return {"ok": True, "message": "Strategy updated"}


@router.delete("/strategies/{strategy_id}")
async def delete_strategy(
    strategy_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    result = await session.execute(
        select(Strategy).where(
            Strategy.id == strategy_id,
            Strategy.user_id == current_user.id
        )
    )
    strategy = result.scalar_one_or_none()
    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")
    
    await session.delete(strategy)
    await session.commit()
    return {"ok": True, "message": "Strategy deleted"}


import logging

logger = logging.getLogger(__name__)


class StartBotBody(BaseModel):
    strategy_id: uuid.UUID = Field(..., description="Strategy to run")
    allocate_margin: bool = Field(True, description="Whether to automatically transfer margin")


@router.post("/start-bot")
async def start_bot(
    body: StartBotBody,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    result = await session.execute(
        select(Strategy).where(
            Strategy.id == body.strategy_id,
            Strategy.user_id == current_user.id
        )
    )
    strategy = result.scalar_one_or_none()
    if strategy is None:
        raise HTTPException(status_code=404, detail="Strategy not found")

    # Combine strategy config and bot config for the trading manager
    full_config = {
        "strategy_id": str(strategy.id),
        "symbol": strategy.trading_pair,
        "interval": strategy.config.get("interval", "1m"),
        "conditions": strategy.config.get("conditions"),
        "bot_config": strategy.bot_config,
        "side": strategy.config.get("side", "buy"),
        "allocate_margin": body.allocate_margin,
    }

    try:
        res = await initialize_bot_for_user(current_user.id, full_config)
        strategy.is_active = True
        
        session.add(
            BotLog(
                user_id=current_user.id,
                strategy_id=strategy.id,
                level="INFO",
                message="Bot started manually"
            )
        )
        
        await session.commit()
        return res
    except Exception as e:
        logger.exception("Failed to start bot")
        raise HTTPException(status_code=400, detail=str(e))


class ManualSignalBody(BaseModel):
    strategy_id: uuid.UUID
    side: str = "buy"


@router.post("/signal")
async def trigger_manual_signal(
    body: ManualSignalBody,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Manually trigger a trade for a running strategy (useful for E2E testing)."""
    result = await session.execute(
        select(Strategy).where(
            Strategy.id == body.strategy_id,
            Strategy.user_id == current_user.id
        )
    )
    strategy = result.scalar_one_or_none()
    if strategy is None:
        raise HTTPException(status_code=404, detail="Strategy not found")

    if not strategy.is_active:
        raise HTTPException(status_code=400, detail="Bot is not running for this strategy")

    # Trigger the trade execution background task
    await _execute_trade(
        user_id=str(current_user.id),
        symbol_raw=strategy.trading_pair,
        bot_config={**strategy.config, **strategy.bot_config},
        side=body.side,
        interval=strategy.config.get("interval", "1h"),
        strategy_id=strategy.id
    )
    
    return {"status": "success", "message": f"Manual {body.side} signal injected"}
