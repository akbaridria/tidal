import type { AdvancedCondition } from "./strategy-builder"

export interface StrategyPreset {
  id: string
  name: string
  description: string
  side: "buy" | "sell"
  logicOperator: "AND" | "OR"
  conditions: AdvancedCondition[]
}

export const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    id: "rsi_oversold",
    name: "RSI Oversold",
    description: "Traditional dip-buying: enters when RSI drops below 30.",
    side: "buy",
    logicOperator: "AND",
    conditions: [
      {
        id: "rsi-1",
        indicator: "RSI",
        params: { period: 14 },
        operator: "<",
        targetType: "value",
        targetValue: 30
      }
    ]
  },
  {
    id: "macd_crossover",
    name: "MACD Crossover",
    description: "Momentum shift: MACD line crosses above Signal line.",
    side: "buy",
    logicOperator: "AND",
    conditions: [
      {
        id: "macd-1",
        indicator: "MACD",
        params: { fast: 12, slow: 26, signal: 9 },
        field: "MACD",
        operator: "crossover",
        targetType: "indicator",
        targetIndicator: "MACD",
        targetParams: { fast: 12, slow: 26, signal: 9 },
        targetField: "MACDs"
      }
    ]
  },
  {
    id: "golden_cross",
    name: "Golden Cross",
    description: "Bullish trend: 50-day SMA crosses above 200-day SMA.",
    side: "buy",
    logicOperator: "AND",
    conditions: [
      {
        id: "sma-1",
        indicator: "SMA",
        params: { period: 50 },
        field: "SMA",
        operator: "crossover",
        targetType: "indicator",
        targetIndicator: "SMA",
        targetParams: { period: 200 },
        targetField: "SMA"
      }
    ]
  },
  {
    id: "rsi_macd_fusion",
    name: "Fusion Strategy",
    description: "Safe & Aggressive: RSI < 40 combined with MACD Crossover.",
    side: "buy",
    logicOperator: "AND",
    conditions: [
      {
        id: "fusion-1",
        indicator: "RSI",
        params: { period: 14 },
        operator: "<",
        targetType: "value",
        targetValue: 40
      },
      {
        id: "fusion-2",
        indicator: "MACD",
        params: { fast: 12, slow: 26, signal: 9 },
        field: "MACD",
        operator: "crossover",
        targetType: "indicator",
        targetIndicator: "MACD",
        targetParams: { fast: 12, slow: 26, signal: 9 },
        targetField: "MACDs"
      }
    ]
  },
  {
    id: "bb_reversion",
    name: "BB Mean Reversion",
    description: "Mean reversion: buy when price touches lower Bollinger Band.",
    side: "buy",
    logicOperator: "AND",
    conditions: [
      {
        id: "bb-1",
        indicator: "Price",
        params: {},
        field: "close",
        operator: "<=",
        targetType: "indicator",
        targetIndicator: "BBANDS",
        targetParams: { period: 20, std: 2.0 },
        targetField: "BBL"
      }
    ]
  }
]
