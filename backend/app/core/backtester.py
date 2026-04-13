from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
import vectorbt as vbt

from app.core.strategy_evaluator import StrategyEvaluator


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
    
    # Respect the chosen side
    side = strategy_config.get("side", "buy").lower()
    
    if side == "buy":
        entries = signals
        exits = ~signals # Simplified: exit when signal is false
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
        direction=direction
    )

    stats = pf.stats()

    return {
        "Total Return [%]": _pct_stat(stats["Total Return [%]"]),
        "Win Rate [%]": _pct_stat(stats["Win Rate [%]"]),
        "Max Drawdown [%]": _pct_stat(stats["Max Drawdown [%]"]),
        "Total Trades": _trade_count(stats["Total Trades"]),
    }
