export interface TradingPairInfo {
  symbol: string
  maxLeverage: number
}

export const TRADING_PAIRS: TradingPairInfo[] = [
  { symbol: "BTC", maxLeverage: 50 },
  { symbol: "ETH", maxLeverage: 50 },
  { symbol: "SOL", maxLeverage: 20 },
  { symbol: "JUP", maxLeverage: 10 },
  { symbol: "WIF", maxLeverage: 5 },
]

export type TradingPair = typeof TRADING_PAIRS[number]["symbol"]
