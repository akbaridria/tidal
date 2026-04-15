from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
import vectorbt as vbt

import logging
from app.core.strategy_evaluator import StrategyEvaluator

logger = logging.getLogger(__name__)


def _pct_stat(val: Any) -> float | None:
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    return float(val)


def _trade_count(val: Any) -> int | None:
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    return int(val)


def run_vectorbt_backtest(df: pd.DataFrame, strategy_config: dict) -> dict:
    """
    Run a vectorbt backtest on OHLCV data using StrategyEvaluator.
    """
    close = df["close"]

    evaluator = StrategyEvaluator(df, strategy_config)
    
    # Generate signals vectorized
    signals = evaluator.evaluate_vectorized()
    
    # Fill NaN with False to prevent vectorbt errors
    signals = signals.fillna(False)
    
    signal_count = int(signals.sum())
    logger.info("Backtest: generated %d signals from evaluation", signal_count)
    
    # Extract SL/TP from bot_config or default
    bot_config = strategy_config.get("bot_config", {})
    sl_pct = float(strategy_config.get("stop_loss_pct", bot_config.get("stop_loss_pct", 2.0)))
    tp_pct = float(strategy_config.get("take_profit_pct", bot_config.get("take_profit_pct", 5.0)))
    
    logger.info("Applying risk management: SL=%.2f%%, TP=%.2f%%", sl_pct, tp_pct)
    
    # Respect the chosen side
    side = strategy_config.get("side", "buy").lower()
    
    if side == "buy":
        entries = signals
        # We still exit if signal becomes false, OR if SL/TP is hit (handled by vbt)
        exits = ~signals 
        direction = "longonly"
    else:
        # For 'sell' side, we treat the signal as a 'Short' entry
        entries = signals
        exits = ~signals
        direction = "shortonly"

    pf = vbt.Portfolio.from_signals(
        close,
        entries,
        exits,
        init_cash=1000,
        fees=0.001,
        direction=direction,
        sl_stop=sl_pct / 100 if sl_pct > 0 else None,
        tp_stop=tp_pct / 100 if tp_pct > 0 else None,
    )

    stats = pf.stats()
    total_trades = _trade_count(stats["Total Trades"])
    logger.info("Backtest complete. Total trades: %s", total_trades)

    return {
        "Total Return [%]": _pct_stat(stats["Total Return [%]"]),
        "Win Rate [%]": _pct_stat(stats["Win Rate [%]"]),
        "Max Drawdown [%]": _pct_stat(stats["Max Drawdown [%]"]),
        "Total Trades": _trade_count(stats["Total Trades"]),
    }
