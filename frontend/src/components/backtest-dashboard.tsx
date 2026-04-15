import { useState } from "react"
import { PlayIcon, BarChart3Icon, TrendingUpIcon, TargetIcon, ShieldAlertIcon, HistoryIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import {
  StrategyBuilder,
  type AdvancedCondition,
  compileStrategyConfig
} from "./strategy-builder"
import { runBacktest } from "@/lib/api"
import { toast } from "sonner"
import { STRATEGY_PRESETS, type StrategyPreset } from "./strategy-presets"

const TRADING_PAIRS = [
  { symbol: "BTC", name: "Bitcoin" },
  { symbol: "ETH", name: "Ethereum" },
  { symbol: "SOL", name: "Solana" },
]

const CANDLE_INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d"]

export function BacktestDashboard() {
  const [tradingPair, setTradingPair] = useState("BTC")
  const [candleInterval, setCandleInterval] = useState("1h")

  // Strategy Builder State
  const [conditions, setConditions] = useState<AdvancedCondition[]>([
    {
      id: "initial",
      indicator: "RSI",
      params: { period: 14 },
      operator: "<",
      targetType: "value",
      targetValue: 30
    }
  ])
  const [logicOperator, setLogicOperator] = useState<"AND" | "OR">("AND")
  const [side, setSide] = useState<"buy" | "sell">("buy")
  const [stopLoss, setStopLoss] = useState(2.0)
  const [takeProfit, setTakeProfit] = useState(5.0)

  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<any>(null)
  const [showResults, setShowResults] = useState(false)

  const handleRunBacktest = async () => {
    setLoading(true)
    setResults(null)
    try {
      const config = compileStrategyConfig(conditions, logicOperator, side)
      const strategyConfig = {
        ...config,
        interval: candleInterval,
        stop_loss_pct: stopLoss,
        take_profit_pct: takeProfit
      }

      const res = await runBacktest({
        symbol: tradingPair,
        timeframe: candleInterval,
        strategy_config: strategyConfig
      })

      setResults(res)
      setShowResults(true)
      toast.success("Backtest simulation successful")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backtest failed")
    } finally {
      setLoading(false)
    }
  }

  const handleApplyPreset = (preset: StrategyPreset) => {
    setConditions(preset.conditions.map(c => ({ ...c, id: Math.random().toString() })))
    setLogicOperator(preset.logicOperator)
    setSide(preset.side)
    toast.info(`Applied ${preset.name} template`)
  }

  return (
    <div className="mx-auto flex flex-col gap-8 py-4">
      {/* Header & Main Config */}
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 rounded-3xl border border-white/[0.04] bg-white/[0.015] p-6 shadow-2xl backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
              <PlayIcon className="size-4 text-[#00D4AA]" />
              Simulation Settings
            </h3>
            {results && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowResults(true)}
                className="h-8 gap-1.5 text-xs text-[#0088CC] hover:bg-[#0088CC]/10 hover:text-[#0088CC]"
              >
                <HistoryIcon className="size-3.5" />
                View Last Result
              </Button>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-white/50 px-1">Trading Pair</label>
              <Select value={tradingPair} onValueChange={(v) => v && setTradingPair(v)}>
                <SelectTrigger className="rounded-xl border-white/[0.06] bg-white/[0.04] text-sm hover:bg-white/[0.06] transition-colors w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRADING_PAIRS.map(p => <SelectItem key={p.symbol} value={p.symbol}>{p.symbol}/USDC</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-white/50 px-1">Candle Interval</label>
              <Select value={candleInterval} onValueChange={(v) => v && setCandleInterval(v)}>
                <SelectTrigger className="rounded-xl border-white/[0.06] bg-white/[0.04] text-sm hover:bg-white/[0.06] transition-colors w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CANDLE_INTERVALS.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-white/50 px-1 flex justify-between">
                Stop Loss (%)
                <span className="text-[#ef4444] font-bold">{stopLoss}%</span>
              </label>
              <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.04] p-1 h-9">
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  className="bg-transparent text-sm text-center w-full focus:outline-none text-white font-medium"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-white/50 px-1 flex justify-between">
                Take Profit (%)
                <span className="text-[#00D4AA] font-bold">{takeProfit}%</span>
              </label>
              <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.04] p-1 h-9">
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  className="bg-transparent text-sm text-center w-full focus:outline-none text-white font-medium"
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2 pt-1">
            <p className="text-[10px] leading-relaxed text-white/20 italic">
              Note: The simulation engine will fetch the most recent 1000 candles from the Pacifica API to calculate performance metrics.
            </p>
          </div>
        </div>

        {/* Strategy Presets Section */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-semibold text-white/50 uppercase tracking-wider">Strategy Templates</h3>
            <span className="text-[10px] text-white/20">Quick start with proven presets</span>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
            {STRATEGY_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handleApplyPreset(preset)}
                className="flex min-w-[200px] flex-col gap-2 rounded-2xl border border-white/[0.04] bg-white/[0.02] p-4 text-left transition-all hover:border-[#00D4AA]/30 hover:bg-white/[0.04] active:scale-95 group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white group-hover:text-[#00D4AA] transition-colors">{preset.name}</span>
                  <div className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase ${preset.side === "buy" ? "bg-[#00D4AA]/10 text-[#00D4AA]" : "bg-[#ef4444]/10 text-[#ef4444]"}`}>
                    {preset.side}
                  </div>
                </div>
                <p className="text-[10px] leading-relaxed text-white/40 line-clamp-2">
                  {preset.description}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-semibold text-white/50 uppercase tracking-wider">Logic Builder</h3>
            <span className="text-[10px] text-white/20">Rules define BUY/SELL signals</span>
          </div>
          <StrategyBuilder
            conditions={conditions}
            setConditions={setConditions}
            logicOperator={logicOperator}
            setLogicOperator={setLogicOperator}
            side={side}
            setSide={setSide}
          />
        </div>

        <Button
          size="lg"
          onClick={handleRunBacktest}
          disabled={loading || conditions.length === 0}
          className="relative h-11 w-full cursor-pointer overflow-hidden rounded-2xl border-0 bg-gradient-to-r from-[#00D4AA] to-[#0088CC] px-8 text-white font-bold transition-all hover:scale-[1.02] active:scale-95 disabled:grayscale"
        >
          {loading ? (
            <div className="flex items-center gap-2">
              <Spinner className="size-5 border-white/30 border-t-white" />
              <span>Simulating Strategy...</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <PlayIcon className="size-3 fill-current" />
              <span>Run Backtest Simulation</span>
            </div>
          )}
        </Button>
      </div>

      {/* Results Modal */}
      <Dialog open={showResults} onOpenChange={setShowResults}>
        <DialogContent className="max-w-md border-white/[0.06] bg-[#0c0e14] p-0 text-white shadow-3xl overflow-hidden rounded-[2rem]">
          <div className="pointer-events-none absolute -right-20 -top-20 h-40 w-40 rounded-full bg-[#00D4AA]/10 blur-[80px]" />
          <div className="pointer-events-none absolute -left-20 -bottom-20 h-40 w-40 rounded-full bg-[#0088CC]/10 blur-[80px]" />

          <DialogHeader className="p-8 pb-4">
            <div className="flex items-center gap-3 mb-1">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br from-[#00D4AA]/20 to-[#0088CC]/20 text-[#00D4AA]">
                <BarChart3Icon className="size-6" />
              </div>
              <div>
                <DialogTitle className="text-2xl font-bold tracking-tight">Simulation Results</DialogTitle>
                <p className="text-xs text-white/30">{tradingPair} / USDC • {candleInterval} Interval</p>
              </div>
            </div>
          </DialogHeader>

          <div className="p-8 pt-0">
            {results && (
              <div className="grid grid-cols-2 gap-4">
                <ResultItem
                  icon={<TrendingUpIcon className="size-4" />}
                  label="Total Return"
                  value={`${results["Total Return [%]"]?.toFixed(2)}%`}
                  accent={results["Total Return [%]"] >= 0 ? "#00D4AA" : "#ef4444"}
                />
                <ResultItem
                  icon={<TargetIcon className="size-4" />}
                  label="Win Rate"
                  value={`${results["Win Rate [%]"]?.toFixed(1) ?? 0}%`}
                  accent="#0088CC"
                />
                <ResultItem
                  icon={<ShieldAlertIcon className="size-4" />}
                  label="Max Drawdown"
                  value={`${results["Max Drawdown [%]"]?.toFixed(2) ?? 0}%`}
                  accent="#a855f7"
                />
                <ResultItem
                  icon={<BarChart3Icon className="size-4" />}
                  label="Total Trades"
                  value={results["Total Trades"]}
                  accent="#64748b"
                />

                <div className="col-span-2 mt-4 space-y-4">
                  <div className="rounded-2xl border border-white/[0.04] bg-white/[0.02] p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-[#00D4AA]" />
                      <span className="text-[10px] uppercase font-bold text-white/30 tracking-widest">Simulation Context</span>
                    </div>
                    <p className="text-xs leading-relaxed text-white/50">
                      Performance is calculated based on standard 0.1% taker fees and initial $1,000 margin. Strategy uses standard indicator signals.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ResultItem({ icon, label, value, accent }: { icon: any; label: string; value: string | number; accent: string }) {
  return (
    <div className="group flex flex-col gap-1.5 rounded-2xl border border-white/[0.04] bg-white/[0.02] p-4 transition-all hover:border-white/[0.08] hover:bg-white/[0.04]">
      <div className="flex items-center gap-2 mb-1">
        <div style={{ color: accent, backgroundColor: `${accent}15` }} className="rounded-lg p-1.5 transition-transform group-hover:scale-110">
          {icon}
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-white/30">{label}</span>
      </div>
      <p style={{ color: value === "N/A" ? "rgba(255,255,255,0.2)" : "white" }} className="font-heading tabular-nums text-2xl font-bold tracking-tight">
        {value ?? "N/A"}
      </p>
    </div>
  )
}
