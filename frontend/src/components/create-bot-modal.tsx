import { useState } from "react"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  PlusIcon,
  RocketIcon,
  ShieldCheckIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
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
import {
  createStrategyFromPreset,
  startBot,
  createStrategy,
  type StrategyPreset,
  type BotConfig,
} from "@/lib/api"
import { TRADING_PAIRS } from "@/lib/constants"



const DEFAULT_BOT_CONFIG: BotConfig = {
  stop_loss_pct: 2,
  take_profit_pct: 5,
  max_slippage_pct: 0.5,
  size_usd: 100,
  leverage: 10,
  margin_mode: "ISOLATED",
}

interface AdvancedCondition {
  id: string
  indicator: string
  params: Record<string, number>
  field?: string
  operator: string
  targetType: "value" | "indicator"
  targetValue?: number
  targetIndicator?: string
  targetParams?: Record<string, number>
  targetField?: string
}

const INDICATORS = [
  { name: "RSI", params: [{ name: "period", default: 14 }], fields: ["RSI"] },
  { name: "SMA", params: [{ name: "period", default: 20 }], fields: ["SMA"] },
  { name: "EMA", params: [{ name: "period", default: 20 }], fields: ["EMA"] },
  { 
    name: "MACD", 
    params: [
      { name: "fast", default: 12 }, 
      { name: "slow", default: 26 }, 
      { name: "signal", default: 9 }
    ], 
    fields: ["MACD", "MACDs", "MACDh"] 
  },
  { 
    name: "BBANDS", 
    params: [
      { name: "period", default: 20 }, 
      { name: "std", default: 2.0 }
    ], 
    fields: ["BBU", "BBM", "BBL"] 
  },
  { name: "Price", params: [], fields: ["close", "high", "low", "open"] },
]

const OPERATORS = [
  { label: "Less than (<)", value: "<" },
  { label: "Greater than (>)", value: ">" },
  { label: "Less than or equal (<=)", value: "<=" },
  { label: "Greater than or equal (>=)", value: ">=" },
  { label: "Crosses Above", value: "crossover" },
  { label: "Crosses Below", value: "crossunder" },
]

interface CreateBotModalProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  presets: StrategyPreset[]
  loadingPresets: boolean
  availableMargin: number
}

type Step = "pair" | "risk" | "review"

export function CreateBotModal({
  open,
  onClose,
  onSuccess,
  presets,
  loadingPresets,
  availableMargin,
}: CreateBotModalProps) {
  const [step, setStep] = useState<Step>("pair")
  const [tradingPair, setTradingPair] = useState(TRADING_PAIRS[0].symbol)
  const [selectedPreset, setSelectedPreset] = useState<StrategyPreset | null>(null)
  const [isAdvancedMode, setIsAdvancedMode] = useState(false)
  const [logicOperator, setLogicOperator] = useState<"AND" | "OR">("AND")
  const [conditions, setConditions] = useState<AdvancedCondition[]>([
    {
      id: "1",
      indicator: "RSI",
      params: { period: 14 },
      operator: "<",
      targetType: "value",
      targetValue: 30,
    },
  ])
  const [customSide, setCustomSide] = useState<"buy" | "sell">("buy")
  const [botConfig, setBotConfig] = useState<BotConfig>(DEFAULT_BOT_CONFIG)
  const [deploying, setDeploying] = useState(false)
  const [deployError, setDeployError] = useState<string | null>(null)

  function resetModal() {
    setStep("pair")
    setTradingPair(TRADING_PAIRS[0].symbol)
    setSelectedPreset(null)
    setBotConfig(DEFAULT_BOT_CONFIG)
    setDeployError(null)
    setIsAdvancedMode(false)
    setConditions([
      {
        id: "1",
        indicator: "RSI",
        params: { period: 14 },
        operator: "<",
        targetType: "value",
        targetValue: 30,
      },
    ])
    setLogicOperator("AND")
    setCustomSide("buy")
  }

  function handleClose() {
    resetModal()
    onClose()
  }

  async function handleDeploy() {
    if (!isAdvancedMode && !selectedPreset) return
    setDeploying(true)
    setDeployError(null)
    try {
      let id: string
      if (isAdvancedMode) {
        // Compile rules into JSON with raw field naming (e.g. RSI_14, MACD_12_26_9)
        const compiledConditions = conditions.map(c => {
          const getTechnicalField = (indicator: string, field: string | undefined, params: Record<string, number>) => {
            if (indicator === "Price") return field || "close"
            if (!field) return undefined
            
            if (indicator === "RSI") return `RSI_${params.period}`
            if (indicator === "SMA") return `SMA_${params.period}`
            if (indicator === "EMA") return `EMA_${params.period}`
            if (indicator === "MACD") {
              const suffix = `${params.fast}_${params.slow}_${params.signal}`
              if (field === "MACD") return `MACD_${suffix}`
              if (field === "MACDs") return `MACDs_${suffix}`
              if (field === "MACDh") return `MACDh_${suffix}`
            }
            if (indicator === "BBANDS") {
              const suffix = `${params.period}_${params.std.toFixed(1)}`
              if (field === "BBU") return `BBU_${suffix}`
              if (field === "BBM") return `BBM_${suffix}`
              if (field === "BBL") return `BBL_${suffix}`
            }
            return field
          }

          const rule: any = {
            operator: c.operator,
            indicator: c.indicator === "Price" ? undefined : c.indicator,
            params: c.params,
            field: getTechnicalField(c.indicator, c.field, c.params),
          }

          if (c.targetType === "value") {
            rule.compare = { value: c.targetValue }
          } else {
            rule.compare = {
              indicator: c.targetIndicator === "Price" ? undefined : c.targetIndicator,
              params: c.targetParams || {},
              field: getTechnicalField(c.targetIndicator || "Price", c.targetField, c.targetParams || {}),
            }
          }
          return rule
        })

        const config = {
          side: customSide,
          conditions: {
            operator: logicOperator,
            expressions: compiledConditions
          }
        }

        const res = await createStrategy({
          trading_pair: tradingPair,
          side: customSide,
          config: config,
          bot_config: botConfig,
          name: "Advance Build",
        })
        id = res.id
      } else {
        const res = await createStrategyFromPreset({
          trading_pair: tradingPair,
          preset_id: selectedPreset!.id,
          bot_config: botConfig,
        })
        id = res.id
      }
      await startBot(id)
      resetModal()
      onSuccess()
    } catch (e) {
      setDeployError(e instanceof Error ? e.message : "Deploy failed")
    } finally {
      setDeploying(false)
    }
  }

  const steps: Step[] = ["pair", "risk", "review"]
  const stepIndex = steps.indexOf(step)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent
        showCloseButton={false}
        className="w-full max-w-lg border-white/[0.06] bg-[#0c0e14] p-0 text-white shadow-2xl sm:max-w-lg"
      >
        {/* Step indicator */}
        <div className="flex items-center gap-0 border-b border-white/[0.04] px-6 pt-5 pb-4">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition-all ${i < stepIndex
                  ? "bg-[#00D4AA] text-black"
                  : i === stepIndex
                    ? "bg-gradient-to-r from-[#00D4AA] to-[#0088CC] text-black"
                    : "bg-white/[0.06] text-white/30"
                  }`}
              >
                {i < stepIndex ? <CheckIcon className="size-3" /> : i + 1}
              </div>
              {i < steps.length - 1 && (
                <div
                  className={`mx-2 h-px w-10 transition-all ${i < stepIndex ? "bg-[#00D4AA]/60" : "bg-white/[0.06]"}`}
                />
              )}
            </div>
          ))}
          <div className="ml-auto">
            <DialogHeader>
              <DialogTitle className="text-sm font-medium text-white/50">
                {step === "pair" && "Choose Pair & Strategy"}
                {step === "risk" && "Risk & Allocation"}
                {step === "review" && "Review & Deploy"}
              </DialogTitle>
            </DialogHeader>
          </div>
        </div>

        <div className="px-6 py-5">
          {/* ── Screen A: Pair & Preset ─────────────────────────────── */}
          {step === "pair" && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-white/50">
                  Trading Pair
                </label>
                <Select
                  value={tradingPair}
                  onValueChange={(value) => { if (value) setTradingPair(value) }}
                >
                  <SelectTrigger className="w-full rounded-xl border-white/[0.06] bg-white/[0.04] text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRADING_PAIRS.map((p) => (
                      <SelectItem key={p.symbol} value={p.symbol}>
                        {p.symbol}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between rounded-2xl bg-white/[0.03] p-4 transition-all hover:bg-white/[0.05]">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-white">Manual Strategy Builder</span>
                    <span className="text-xs text-white/30">Build custom rules instead of using presets</span>
                  </div>
                  <Switch
                    checked={isAdvancedMode}
                    onCheckedChange={setIsAdvancedMode}
                  />
                </div>

                {isAdvancedMode ? (
                  <div className="flex flex-col gap-5 rounded-2xl border border-white/[0.06] bg-white/[0.01] p-5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-white/50">Strategy Rules</label>
                      <div className="flex rounded-lg bg-white/[0.04] p-1">
                        <button
                          onClick={() => setLogicOperator("AND")}
                          className={`rounded-md px-3 py-1 text-[10px] font-medium transition-all ${logicOperator === "AND" ? "bg-white/10 text-[#00D4AA]" : "text-white/40"}`}
                        >
                          ALL MUST MATCH
                        </button>
                        <button
                          onClick={() => setLogicOperator("OR")}
                          className={`rounded-md px-3 py-1 text-[10px] font-medium transition-all ${logicOperator === "OR" ? "bg-white/10 text-[#00D4AA]" : "text-white/40"}`}
                        >
                          ANY CAN MATCH
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-4">
                      {conditions.map((cond, index) => (
                        <div key={cond.id} className="group relative flex flex-col gap-4 rounded-xl border border-white/[0.04] bg-white/[0.02] p-4">
                          <button
                            onClick={() => setConditions(conditions.filter(c => c.id !== cond.id))}
                            className="absolute -right-2 -top-2 hidden h-6 w-6 items-center justify-center rounded-full bg-red-500/10 text-red-500 transition-all hover:bg-red-500 hover:text-white group-hover:flex"
                          >
                            <Trash2Icon className="size-3" />
                          </button>

                          <div className="flex flex-col gap-3">
                            <div className="grid grid-cols-2 gap-3">
                              <Select
                                value={cond.indicator}
                                onValueChange={(v) => {
                                  if (v) {
                                    const newConds = [...conditions]
                                    const indicatorDef = INDICATORS.find(i => i.name === v)
                                    newConds[index].indicator = v
                                    newConds[index].field = indicatorDef?.fields[0]
                                    newConds[index].params = indicatorDef?.params.reduce((acc: any, p) => ({ ...acc, [p.name]: p.default }), {}) || {}
                                    setConditions(newConds)
                                  }
                                }}
                              >
                                <SelectTrigger className="h-8 text-xs w-full">
                                  <SelectValue placeholder="Indicator" />
                                </SelectTrigger>
                                <SelectContent>
                                  {INDICATORS.map(i => <SelectItem key={i.name} value={i.name}>{i.name}</SelectItem>)}
                                </SelectContent>
                              </Select>

                              <Select
                                value={cond.operator}
                                onValueChange={(v) => {
                                  if (v) {
                                    const newConds = [...conditions]
                                    newConds[index].operator = v
                                    setConditions(newConds)
                                  }
                                }}
                              >
                                <SelectTrigger className="h-8 text-xs w-full">
                                  <SelectValue placeholder="Operator" />
                                </SelectTrigger>
                                <SelectContent>
                                  {OPERATORS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>

                            {/* Params and Field for Primary Indicator */}
                            <div className="flex flex-wrap items-center gap-2">
                              {INDICATORS.find(i => i.name === cond.indicator)?.params.map(p => (
                                <div key={p.name} className="flex items-center gap-1.5 rounded-lg bg-white/[0.03] px-2 py-1">
                                  <span className="text-[10px] uppercase text-white/30">{p.name}</span>
                                  <input
                                    type="number"
                                    className="w-10 bg-transparent text-[10px] font-medium text-[#00D4AA] focus:outline-none"
                                    value={cond.params[p.name]}
                                    onChange={e => {
                                      const newConds = [...conditions]
                                      newConds[index].params[p.name] = parseFloat(e.target.value) || 0
                                      setConditions(newConds)
                                    }}
                                  />
                                </div>
                              ))}
                              {INDICATORS.find(i => i.name === cond.indicator)?.fields.length! > 1 && (
                                <Select
                                  value={cond.field}
                                  onValueChange={(v) => {
                                    if (v) {
                                      const newConds = [...conditions]
                                      newConds[index].field = v
                                      setConditions(newConds)
                                    }
                                  }}
                                >
                                  <SelectTrigger className="h-6 w-24 px-2 py-0 text-[10px] bg-white/[0.03] border-0">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {INDICATORS.find(i => i.name === cond.indicator)?.fields.map(f => (
                                      <SelectItem key={f} value={f} className="text-[10px]">{f}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-col gap-3 pt-3 border-t border-white/[0.03]">
                            <div className="flex items-center gap-3">
                              <div className="flex-1">
                                {cond.targetType === "value" ? (
                                  <Input
                                    type="number"
                                    placeholder="Target Value"
                                    value={cond.targetValue}
                                    onChange={e => {
                                      const newConds = [...conditions]
                                      newConds[index].targetValue = parseFloat(e.target.value)
                                      setConditions(newConds)
                                    }}
                                    className="h-8 text-xs"
                                  />
                                ) : (
                                  <div className="flex flex-col gap-2">
                                    <div className="grid grid-cols-2 gap-2">
                                      <Select
                                        value={cond.targetIndicator}
                                        onValueChange={(v) => {
                                          if (v) {
                                            const newConds = [...conditions]
                                            const indicatorDef = INDICATORS.find(i => i.name === v)
                                            newConds[index].targetIndicator = v
                                            newConds[index].targetField = indicatorDef?.fields[0]
                                            newConds[index].targetParams = indicatorDef?.params.reduce((acc: any, p) => ({ ...acc, [p.name]: p.default }), {}) || {}
                                            setConditions(newConds)
                                          }
                                        }}
                                      >
                                        <SelectTrigger className="h-8 text-xs">
                                          <SelectValue placeholder="Compare to..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {INDICATORS.map(i => <SelectItem key={i.name} value={i.name}>{i.name}</SelectItem>)}
                                        </SelectContent>
                                      </Select>
                                      
                                      {INDICATORS.find(i => i.name === cond.targetIndicator)?.fields.length! > 1 && (
                                        <Select
                                          value={cond.targetField}
                                          onValueChange={(v) => {
                                            if (v) {
                                              const newConds = [...conditions]
                                              newConds[index].targetField = v
                                              setConditions(newConds)
                                            }
                                          }}
                                        >
                                          <SelectTrigger className="h-8 text-xs">
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {INDICATORS.find(i => i.name === cond.targetIndicator)?.fields.map(f => (
                                              <SelectItem key={f} value={f} className="text-xs">{f}</SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      )}
                                    </div>

                                    {/* Params for Target Indicator */}
                                    <div className="flex flex-wrap items-center gap-2">
                                      {INDICATORS.find(i => i.name === cond.targetIndicator)?.params.map(p => (
                                        <div key={p.name} className="flex items-center gap-1.5 rounded-lg bg-white/[0.03] px-2 py-1">
                                          <span className="text-[10px] uppercase text-white/30">{p.name}</span>
                                          <input
                                            type="number"
                                            className="w-10 bg-transparent text-[10px] font-medium text-[#00D4AA] focus:outline-none"
                                            value={cond.targetParams?.[p.name]}
                                            onChange={e => {
                                              const newConds = [...conditions]
                                              newConds[index].targetParams![p.name] = parseFloat(e.target.value) || 0
                                              setConditions(newConds)
                                            }}
                                          />
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => {
                                  const newConds = [...conditions]
                                  newConds[index].targetType = cond.targetType === "value" ? "indicator" : "value"
                                  if (newConds[index].targetType === "indicator" && !newConds[index].targetIndicator) {
                                    newConds[index].targetIndicator = "SMA"
                                    newConds[index].targetParams = { period: 20 }
                                    newConds[index].targetField = "SMA"
                                  }
                                  setConditions(newConds)
                                }}
                                className="text-[10px] text-white/30 hover:text-white"
                              >
                                {cond.targetType === "value" ? "Use Indicator" : "Use Value"}
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConditions([...conditions, {
                          id: Math.random().toString(),
                          indicator: "RSI",
                          params: { period: 14 },
                          operator: "<",
                          targetType: "value",
                          targetValue: 50
                        }])}
                        className="h-8 border-dashed border-white/10 bg-transparent text-white/40 hover:bg-white/[0.04] hover:text-white"
                      >
                        <PlusIcon className="mr-2 size-3" />
                        Add Rule
                      </Button>
                    </div>

                    <div className="flex flex-col gap-1.5 pt-2 border-t border-white/[0.04]">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-white/50">Final Action</label>
                        <div className="flex h-8 rounded-lg bg-white/[0.04] p-1">
                          <button
                            onClick={() => setCustomSide("buy")}
                            className={`rounded-md px-4 py-0 text-[10px] font-medium transition-all ${customSide === "buy" ? "bg-[#00D4AA] text-black" : "text-white/40"}`}
                          >
                            BUY
                          </button>
                          <button
                            onClick={() => setCustomSide("sell")}
                            className={`rounded-md px-4 py-0 text-[10px] font-medium transition-all ${customSide === "sell" ? "bg-[#ef4444] text-white" : "text-white/40"}`}
                          >
                            SELL
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : loadingPresets ? (
                  <div className="flex justify-center py-6">
                    <Spinner className="size-5 text-white/30" />
                  </div>
                ) : presets.length === 0 ? (
                  <p className="py-4 text-center text-sm text-white/30">
                    No presets available
                  </p>
                ) : (
                  <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
                    {presets.map((preset) => (
                      <PresetCard
                        key={preset.id}
                        preset={preset}
                        selected={selectedPreset?.id === preset.id}
                        onSelect={() => setSelectedPreset(preset)}
                      />
                    ))}
                  </div>
                )}
              </div>

              <Button
                onClick={() => setStep("risk")}
                disabled={!isAdvancedMode && !selectedPreset}
                className="cursor-pointer w-full rounded-xl border-0 bg-gradient-to-r from-[#00D4AA] to-[#0088CC] text-white"
              >
                Continue
                <ArrowRightIcon className="ml-1.5 size-4" />
              </Button>
            </div>
          )}

          {/* ── Screen B: Risk & Allocation ─────────────────────────── */}
          {step === "risk" && (
            <div className="flex flex-col gap-5">
              <div className="rounded-xl border border-[#0088CC]/20 bg-[#0088CC]/5 px-4 py-3">
                <p className="text-xs text-[#88ccff]">
                  <strong className="font-semibold">Isolated Margin</strong> —
                  Your maximum risk exposure for this bot is exactly the capital
                  you allocate below. Other strategies are unaffected.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-white/50">
                    Capital Allocation (USDC)
                  </label>
                  <span className="text-xs text-white/30">
                    Available: ${availableMargin.toFixed(2)}
                  </span>
                </div>
                <div className="relative">
                  <Input
                    type="number"
                    value={botConfig.size_usd}
                    onChange={(e) =>
                      setBotConfig((c) => ({
                        ...c,
                        size_usd: parseFloat(e.target.value) || 0,
                      }))
                    }
                    className="pr-16 font-mono text-base"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/30">
                    USDC
                  </span>
                </div>
                <div className="mt-1 flex gap-2">
                  {[25, 50, 100, 200].map((v) => (
                    <button
                      key={v}
                      onClick={() =>
                        setBotConfig((c) => ({ ...c, size_usd: v }))
                      }
                      className={`cursor-pointer rounded-lg px-2.5 py-1 text-xs transition-all ${botConfig.size_usd === v
                        ? "bg-[#00D4AA]/15 text-[#00D4AA]"
                        : "bg-white/[0.04] text-white/40 hover:bg-white/[0.08]"
                        }`}
                    >
                      ${v}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <RiskInput
                  label="Stop Loss"
                  value={botConfig.stop_loss_pct}
                  onChange={(v) =>
                    setBotConfig((c) => ({ ...c, stop_loss_pct: v }))
                  }
                  suffix="%"
                  accent="#ef4444"
                />
                <RiskInput
                  label="Take Profit"
                  value={botConfig.take_profit_pct}
                  onChange={(v) =>
                    setBotConfig((c) => ({ ...c, take_profit_pct: v }))
                  }
                  suffix="%"
                  accent="#22c55e"
                />
                <RiskInput
                  label="Max Slippage"
                  value={botConfig.max_slippage_pct}
                  onChange={(v) =>
                    setBotConfig((c) => ({ ...c, max_slippage_pct: v }))
                  }
                  suffix="%"
                  accent="#f59e0b"
                />
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setStep("pair")}
                  className="cursor-pointer flex-1 rounded-xl border-white/10 text-white/60"
                >
                  <ArrowLeftIcon className=" size-4" />
                  Back
                </Button>
                <Button
                  onClick={() => setStep("review")}
                  disabled={botConfig.size_usd <= 0}
                  className="cursor-pointer flex-1 rounded-xl border-0 bg-gradient-to-r from-[#00D4AA] to-[#0088CC] text-white"
                >
                  Review
                  <ArrowRightIcon className="ml-1.5 size-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ── Screen C: Review & Deploy ───────────────────────────── */}
          {step === "review" && (
            <div className="flex flex-col gap-5">
              <div className="rounded-2xl border border-white/[0.04] bg-white/[0.02] divide-y divide-white/[0.04]">
                <ReviewRow label="Trading Pair" value={tradingPair} highlight />
                <ReviewRow label="Strategy" value={isAdvancedMode ? "Custom Strategy" : (selectedPreset?.name ?? "")} />
                <ReviewRow
                  label="Capital Allocated"
                  value={`$${botConfig.size_usd.toFixed(2)} USDC`}
                  highlight
                />
                <ReviewRow
                  label="Stop Loss"
                  value={`${botConfig.stop_loss_pct}%`}
                />
                <ReviewRow
                  label="Take Profit"
                  value={`${botConfig.take_profit_pct}%`}
                />
                <ReviewRow
                  label="Max Slippage"
                  value={`${botConfig.max_slippage_pct}%`}
                />
                <ReviewRow label="Margin Mode" value="ISOLATED" />
              </div>

              <div className="flex items-start gap-2 rounded-xl border border-[#00D4AA]/15 bg-[#00D4AA]/5 px-4 py-3">
                <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-[#00D4AA]" />
                <p className="text-xs leading-relaxed text-[#00D4AA]/80">
                  This bot will trade in complete isolation. Your maximum risk is{" "}
                  <strong>${botConfig.size_usd.toFixed(2)}</strong>. If this bot
                  is liquidated, your other strategies are unaffected.
                </p>
              </div>

              {deployError && (
                <p className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs text-red-400">
                  {deployError}
                </p>
              )}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setStep("risk")}
                  disabled={deploying}
                  className="cursor-pointer flex-1 rounded-xl border-white/10 text-white/60"
                >
                  <ArrowLeftIcon className=" size-4" />
                  Back
                </Button>
                <Button
                  onClick={handleDeploy}
                  disabled={deploying}
                  className="cursor-pointer flex-1 rounded-xl border-0 bg-gradient-to-r from-[#00D4AA] to-[#0088CC] text-white font-semibold"
                >
                  {deploying ? (
                    <Spinner className="" />
                  ) : (
                    <RocketIcon className=" size-4" />
                  )}
                  {deploying ? "Deploying…" : "Deploy Bot"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PresetCard({
  preset,
  selected,
  onSelect,
}: {
  preset: StrategyPreset
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 text-left transition-all ${selected
        ? "border-[#00D4AA]/40 bg-[#00D4AA]/8"
        : "border-white/[0.04] bg-white/[0.02] hover:border-white/[0.08] hover:bg-white/[0.04]"
        }`}
    >
      <div
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all ${selected ? "bg-[#00D4AA]/20 text-[#00D4AA]" : "bg-white/[0.06] text-white/30"
          }`}
      >
        <ZapIcon className="size-3.5" />
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white/90">{preset.name}</span>
          {selected && (
            <Badge
              variant="outline"
              className="border-[#00D4AA]/30 bg-[#00D4AA]/10 text-[#00D4AA] text-[10px] py-0"
            >
              Selected
            </Badge>
          )}
        </div>
        {preset.description && (
          <p className="mt-0.5 truncate text-xs text-white/35">
            {preset.description}
          </p>
        )}
      </div>
      {selected && <CheckIcon className="mt-0.5 size-4 shrink-0 text-[#00D4AA]" />}
    </button>
  )
}

function RiskInput({
  label,
  value,
  onChange,
  suffix,
  accent,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  suffix: string
  accent: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-white/40">{label}</label>
      <div className="relative">
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="pr-7 font-mono text-sm"
          style={{ borderColor: `${accent}30` }}
        />
        <span
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-medium"
          style={{ color: accent }}
        >
          {suffix}
        </span>
      </div>
    </div>
  )
}

function ReviewRow({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-xs text-white/40">{label}</span>
      <span
        className={`text-sm font-medium ${highlight ? "text-white" : "text-white/70"}`}
      >
        {value}
      </span>
    </div>
  )
}
