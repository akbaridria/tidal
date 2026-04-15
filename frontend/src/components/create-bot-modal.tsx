import { useState } from "react"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  RocketIcon,
  ShieldCheckIcon,
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

import {
  StrategyBuilder,
  type AdvancedCondition,
  compileStrategyConfig,
} from "./strategy-builder"





const CANDLE_INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d"]


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
  const [candleInterval, setCandleInterval] = useState("1h")

  function resetModal() {
    setStep("pair")
    setTradingPair(TRADING_PAIRS[0].symbol)
    setCandleInterval("1h")
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
        const config = compileStrategyConfig(conditions, logicOperator, customSide)
        // Add interval
        const strategyConfig = { ...config, interval: candleInterval }

        const res = await createStrategy({
          trading_pair: tradingPair,
          side: customSide,
          config: strategyConfig,
          bot_config: botConfig,
          name: "Advance Build",
        })
        id = res.id
      } else {
        const res = await createStrategyFromPreset({
          trading_pair: tradingPair,
          preset_id: selectedPreset!.id,
          interval: candleInterval,
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

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-white/50">
                  Candle Interval
                </label>
                <Select
                  value={candleInterval}
                  onValueChange={(value) => { if (value) setCandleInterval(value) }}
                >
                  <SelectTrigger className="w-full rounded-xl border-white/[0.06] bg-white/[0.04] text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CANDLE_INTERVALS.map((intv) => (
                      <SelectItem key={intv} value={intv}>
                        {intv}
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
                  <StrategyBuilder
                    conditions={conditions}
                    setConditions={setConditions}
                    logicOperator={logicOperator}
                    setLogicOperator={setLogicOperator}
                    side={customSide}
                    setSide={setCustomSide}
                  />
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
    </Dialog >
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
