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


from app.worker.trading_manager import initialize_bot_for_user, stop_bot_for_user


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
        await session.commit()
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
        config=preset["config"],
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
    return CreateStrategyResponse(id=strategy.id)


@router.get("/strategies")
async def list_strategies(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    result = await session.execute(select(Strategy).where(Strategy.user_id == current_user.id))
    strategies = result.scalars().all()
    return [
        {
            "id": str(s.id),
            "name": s.name,
            "trading_pair": s.trading_pair,
            "config": s.config,
            "bot_config": s.bot_config,
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
    
    return {
        "id": str(strategy.id),
        "name": strategy.name,
        "trading_pair": strategy.trading_pair,
        "config": strategy.config,
        "bot_config": strategy.bot_config,
        "created_at": strategy.created_at.isoformat() if strategy.created_at else None,
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
    }

    try:
        res = await initialize_bot_for_user(current_user.id, full_config)
        strategy.is_active = True
        await session.commit()
        return res
    except Exception as e:
        logger.exception("Failed to start bot")
        raise HTTPException(status_code=400, detail=str(e))
