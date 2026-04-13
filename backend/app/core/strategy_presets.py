from typing import Any, Dict, List

STRATEGY_PRESETS: List[Dict[str, Any]] = [
    {
        "id": "rsi_oversold",
        "name": "RSI Oversold",
        "description": "Buy when RSI is below 30 (Oversold condition)",
        "config": {
            "side": "buy",
            "interval": "1h",
            "conditions": {
                "operator": "<",
                "indicator": "RSI",
                "params": {"period": 14},
                "compare": {"value": 30}
            }
        }
    },
    {
        "id": "macd_crossover",
        "name": "MACD Crossover",
        "description": "Buy when MACD line crosses above the signal line",
        "config": {
            "side": "buy",
            "interval": "1h",
            "conditions": {
                "operator": "crossover",
                "indicator": "MACD",
                "params": {"fast": 12, "slow": 26, "signal": 9},
                "field": "MACD_12_26_9",
                "compare": {
                    "indicator": "MACD",
                    "params": {"fast": 12, "slow": 26, "signal": 9},
                    "field": "MACDs_12_26_9"
                }
            }
        }
    },
    {
        "id": "rsi_macd_combo",
        "name": "RSI + MACD Fusion",
        "description": "Aggressive: RSI < 40 and MACD Crossover",
        "config": {
            "side": "buy",
            "interval": "1h",
            "conditions": {
                "operator": "AND",
                "expressions": [
                    {
                        "operator": "<",
                        "indicator": "RSI",
                        "params": {"period": 14},
                        "compare": {"value": 40}
                    },
                    {
                        "operator": "crossover",
                        "indicator": "MACD",
                        "params": {"fast": 12, "slow": 26, "signal": 9},
                        "field": "MACD_12_26_9",
                        "compare": {
                            "indicator": "MACD",
                            "params": {"fast": 12, "slow": 26, "signal": 9},
                            "field": "MACDs_12_26_9"
                        }
                    }
                ]
            }
        }
    },
    {
        "id": "golden_cross",
        "name": "Golden Cross",
        "description": "Long-term bullish: 50 SMA crosses above 200 SMA",
        "config": {
            "side": "buy",
            "interval": "1d",
            "conditions": {
                "operator": "crossover",
                "indicator": "SMA",
                "params": {"period": 50},
                "compare": {
                    "indicator": "SMA",
                    "params": {"period": 200}
                }
            }
        }
    },
    {
        "id": "bb_reversion",
        "name": "Bollinger Reversion",
        "description": "Buy when price touches the lower Bollinger Band",
        "config": {
            "side": "buy",
            "interval": "15m",
            "conditions": {
                "operator": "<=",
                "field": "close",
                "compare": {
                    "indicator": "BBANDS",
                    "params": {"period": 20, "std": 2.0},
                    "field": "BBL_20_2.0"
                }
            }
        }
    }
]
