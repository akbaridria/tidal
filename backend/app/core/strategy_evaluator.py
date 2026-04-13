from __future__ import annotations

import logging
from typing import Any, Optional

import pandas as pd
import pandas_ta as ta

logger = logging.getLogger(__name__)


class StrategyEvaluator:
    """
    Evaluates a standardized JSON strategy against a pandas DataFrame.
    """

    def __init__(self, df: pd.DataFrame, config: dict[str, Any], indicator_cache: Optional[dict[str, Any]] = None):
        self.df = df.copy()
        self.config = config
        # Use shared cache if provided, otherwise local cache
        self._calculated_indicators = indicator_cache if indicator_cache is not None else {}

    def _get_indicator(self, indicator_name: str, params: dict[str, Any]) -> pd.Series | pd.DataFrame:
        key = f"{indicator_name}_{str(params)}"
        if key in self._calculated_indicators:
            return self._calculated_indicators[key]

        name = indicator_name.upper()
        if name == "RSI":
            res = ta.rsi(self.df["close"], length=params.get("period", 14))
        elif name == "MACD":
            res = ta.macd(
                self.df["close"],
                fast=params.get("fast", 12),
                slow=params.get("slow", 26),
                signal=params.get("signal", 9),
            )
        elif name == "SMA":
            res = ta.sma(self.df["close"], length=params.get("period", 20))
        elif name == "EMA":
            res = ta.ema(self.df["close"], length=params.get("period", 20))
        elif name == "BBANDS":
            res = ta.bbands(
                self.df["close"],
                length=params.get("period", 20),
                std=params.get("std", 2.0),
            )
        elif name == "STOCH":
            res = ta.stoch(
                self.df["high"],
                self.df["low"],
                self.df["close"],
                k=params.get("k", 14),
                d=params.get("d", 3),
                smooth_k=params.get("smooth_k", 3),
            )
        elif name == "ATR":
            res = ta.atr(
                self.df["high"],
                self.df["low"],
                self.df["close"],
                length=params.get("period", 14),
            )
        elif name == "ADX":
            res = ta.adx(
                self.df["high"],
                self.df["low"],
                self.df["close"],
                length=params.get("period", 14),
            )
        elif name == "CCI":
            res = ta.cci(
                self.df["high"],
                self.df["low"],
                self.df["close"],
                length=params.get("period", 14),
            )
        elif name == "VWAP":
            res = ta.vwap(
                self.df["high"],
                self.df["low"],
                self.df["close"],
                self.df["volume"],
            )
        else:
            raise ValueError(f"Unsupported indicator: {indicator_name}")

        self._calculated_indicators[key] = res
        return res

    def _get_value(self, expr: dict[str, Any], index: Optional[int] = None) -> float | pd.Series:
        """Extracts a value from an expression (either a constant or an indicator field)."""
        if "value" in expr:
            val = float(expr["value"])
            if index is None:
                return pd.Series(val, index=self.df.index)
            return val

        indicator_name = expr.get("indicator")
        if not indicator_name:
            # Fallback to direct field in DF (e.g. "close", "open")
            field = expr.get("field", "close")
            if index is None:
                return self.df[field]
            return float(self.df[field].iloc[index])

        res = self._get_indicator(indicator_name, expr.get("params", {}))
        field = expr.get("field")

        if isinstance(res, pd.DataFrame):
            if not field:
                series = res.iloc[:, 0]
            else:
                series = res[field]
        else:
            series = res
        
        if index is None:
            return series
        
        if series is None or len(series) == 0:
            return 0.0
            
        try:
            val = series.iloc[index]
            if pd.isna(val):
                return 0.0
            return float(val)
        except (IndexError, ValueError):
            return 0.0

    def evaluate(self, index: int = -1) -> bool:
        """Evaluates the strategy at a specific index and returns True if conditions are met."""
        conditions = self.config.get("conditions")
        if not conditions:
            return False
        
        return self._evaluate_recursive(conditions, index)

    def evaluate_vectorized(self) -> pd.Series:
        """Evaluates the strategy for the entire DataFrame and returns a boolean Series."""
        conditions = self.config.get("conditions")
        if not conditions:
            return pd.Series(False, index=self.df.index)
        
        return self._evaluate_recursive_vectorized(conditions)

    def _evaluate_recursive(self, node: dict[str, Any], index: int) -> bool:
        operator = node.get("operator", "AND").upper()
        
        if operator in ("AND", "OR"):
            expressions = node.get("expressions", [])
            if not expressions:
                return True if operator == "AND" else False
            
            results = [self._evaluate_recursive(exp, index) for exp in expressions]
            if operator == "AND":
                return all(results)
            else:
                return any(results)
        
        # Leaf node (comparison)
        return self._evaluate_comparison(node, index)

    def _evaluate_comparison(self, node: dict[str, Any], index: int) -> bool:
        op = node.get("operator")
        val1 = self._get_value(node, index=index)
        
        # For crossover/crossunder we need previous values
        if op in ("crossover", "crossunder"):
            if index == 0 or (index == -1 and len(self.df) < 2):
                return False
                
            prev_idx = index - 1 if index != -1 else -2
            val1_prev = self._get_value(node, index=prev_idx)
            
            # Comparison value (could be another indicator or a constant)
            compare_node = node.get("compare", {})
            val2 = self._get_value(compare_node, index=index)
            val2_prev = self._get_value(compare_node, index=prev_idx)
            
            if op == "crossover":
                return val1_prev <= val2_prev and val1 > val2
            else: # crossunder
                return val1_prev >= val2_prev and val1 < val2

        compare_node = node.get("compare", {})
        val2 = self._get_value(compare_node, index=index)

        if op == ">": return val1 > val2
        if op == "<": return val1 < val2
        if op == ">=": return val1 >= val2
        if op == "<=": return val1 <= val2
        if op == "==": return val1 == val2
        if op == "!=": return val1 != val2
        
        raise ValueError(f"Unsupported operator: {op}")

    def _evaluate_recursive_vectorized(self, node: dict[str, Any]) -> pd.Series:
        operator = node.get("operator", "AND").upper()
        
        if operator in ("AND", "OR"):
            expressions = node.get("expressions", [])
            if not expressions:
                return pd.Series(True if operator == "AND" else False, index=self.df.index)
            
            results = [self._evaluate_recursive_vectorized(exp) for exp in expressions]
            if operator == "AND":
                res = results[0]
                for r in results[1:]:
                    res = res & r
                return res
            else:
                res = results[0]
                for r in results[1:]:
                    res = res | r
                return res
        
        # Leaf node (comparison)
        return self._evaluate_comparison_vectorized(node)

    def _evaluate_comparison_vectorized(self, node: dict[str, Any]) -> pd.Series:
        op = node.get("operator")
        val1 = self._get_value(node, index=None)
        
        compare_node = node.get("compare", {})
        val2 = self._get_value(compare_node, index=None)

        if op in ("crossover", "crossunder"):
            val1_prev = val1.shift(1)
            val2_prev = val2.shift(1)
            
            if op == "crossover":
                return (val1_prev <= val2_prev) & (val1 > val2)
            else: # crossunder
                return (val1_prev >= val2_prev) & (val1 < val2)

        if op == ">": return val1 > val2
        if op == "<": return val1 < val2
        if op == ">=": return val1 >= val2
        if op == "<=": return val1 <= val2
        if op == "==": return val1 == val2
        if op == "!=": return val1 != val2
        
        raise ValueError(f"Unsupported operator: {op}")
