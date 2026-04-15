/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react"
import {
  ActivityIcon,
  AlertCircleIcon,
  BotIcon,
  PlusIcon,
  MinusIcon,
  ScrollTextIcon,
  SquareIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { SupplyMarginModal } from "@/components/supply-margin-modal"
import { getBotLogs, stopBot, startBot, withdrawSubaccountFunds, getStrategy, type Strategy, type BotLog } from "@/lib/api"

interface ActiveBotsDashboardProps {
  strategies: Strategy[]
  loading: boolean
  error: string | null
  onRefresh: () => void
  onLaunchBot: () => void
  hasBotWallet: boolean
}

export function ActiveBotsDashboard({
  strategies,
  loading,
  error,
  onRefresh,
  onLaunchBot,
  hasBotWallet,
  availableMargin = 0,
}: ActiveBotsDashboardProps & { availableMargin?: number }) {
  const [logsStrategyId, setLogsStrategyId] = useState<string | null>(null)
  const [supplyingStrategyId, setSupplyingStrategyId] = useState<string | null>(null)

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-heading text-xl font-semibold text-white">
              Active Bots
            </h2>
            <p className="mt-0.5 text-sm text-white/40">
              Monitor and manage your running strategies
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={onLaunchBot}
              disabled={!hasBotWallet}
              size="sm"
              className="cursor-pointer rounded-xl border-0 bg-gradient-to-r from-[#00D4AA] to-[#0088CC] text-white disabled:opacity-30 disabled:grayscale"
            >
              <PlusIcon className=" size-4" />
              {hasBotWallet ? "Launch Bot" : "Wallet Required"}
            </Button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
            <AlertCircleIcon className="size-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-10">
            <Spinner className="size-6 text-white/30" />
          </div>
        )}

        {/* Empty */}
        {!loading && strategies.length === 0 && (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#00D4AA]/10 text-[#00D4AA]">
              <BotIcon className="size-5" />
            </div>
            <div>
              <p className="font-medium text-white/70">No Bots Deployed</p>
              <p className="mt-1 text-sm text-white/30">
                Launch your first automated trading bot
              </p>
            </div>
            <Button
              onClick={onLaunchBot}
              disabled={!hasBotWallet}
              className="cursor-pointer rounded-xl border-0 bg-gradient-to-r from-[#00D4AA] to-[#0088CC] text-white disabled:opacity-30 disabled:grayscale"
            >
              <PlusIcon className="mr-2 size-4" />
              {hasBotWallet ? "Launch New Bot" : "Generate Wallet"}
            </Button>
          </div>
        )}

        {/* Bot cards grid */}
        {!loading && strategies.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {strategies.map((strategy) => (
              <BotCard
                key={strategy.id}
                strategy={strategy}
                onSupply={() => setSupplyingStrategyId(strategy.id)}
                onViewLogs={() => setLogsStrategyId(strategy.id)}
              />
            ))}
          </div>
        )}

        {/* Logs Drawer */}
        {logsStrategyId && (
          <LogsDrawer
            strategyId={logsStrategyId}
            strategyName={
              strategies.find((s) => s.id === logsStrategyId)?.name ?? "Bot"
            }
            onClose={() => setLogsStrategyId(null)}
          />
        )}

        {/* Supply Margin Modal */}
        <SupplyMarginModal
          open={Boolean(supplyingStrategyId)}
          onClose={() => setSupplyingStrategyId(null)}
          onSuccess={() => {
            setSupplyingStrategyId(null)
            onRefresh()
          }}
          strategy={strategies.find((s) => s.id === supplyingStrategyId) ?? null}
          availableMargin={availableMargin}
        />
      </div>
    </TooltipProvider>
  )
}

function BotCard({
  strategy: initialStrategy,
  onSupply,
  onViewLogs,
}: {
  strategy: Strategy
  onSupply: () => void
  onViewLogs: () => void
}) {
  const [strategy, setStrategy] = useState<Strategy>(initialStrategy)
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  const fetchDetail = async () => {
    setLoading(true)
    try {
      const detail = await getStrategy(initialStrategy.id)
      setStrategy(detail)
    } catch {
      // fallback
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDetail()
  }, [initialStrategy.id])

  async function handleStop() {
    setActionLoading(true)
    try {
      await stopBot(strategy.id)
      toast.success("Bot stopped")
      await fetchDetail()
    } catch (e: any) {
      toast.error(e.message || "Failed to stop bot")
    } finally {
      setActionLoading(false)
    }
  }

  async function handleStart() {
    setActionLoading(true)
    try {
      await startBot(strategy.id, false)
      toast.success("Bot started")
      await fetchDetail()
    } catch (e: any) {
      toast.error(e.message || "Failed to start bot")
    } finally {
      setActionLoading(false)
    }
  }

  async function handleWithdraw() {
    setActionLoading(true)
    try {
      const res = await withdrawSubaccountFunds(strategy.id)
      toast.success(res.message)
      await fetchDetail()
    } catch (e: any) {
      toast.error(e.message || "Failed to withdraw funds")
    } finally {
      setActionLoading(false)
    }
  }

  const isActive = strategy.is_active !== false
  const allocatedMargin = strategy.allocated_margin ?? strategy.bot_config?.size_usd ?? 0
  const pendingMargin = strategy.pending_margin ?? 0
  const stopLoss = strategy.bot_config?.stop_loss_pct ?? 0
  const takeProfit = strategy.bot_config?.take_profit_pct ?? 0

  return (
    <div className="group relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-white/[0.04] bg-white/[0.015] p-5 transition-all hover:border-white/[0.08]">
      {/* Glow */}
      <div
        className={`pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full blur-2xl transition-opacity ${isActive ? "bg-[#00D4AA]/10" : "bg-white/[0.03]"}`}
      />

      {/* Top row */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-heading text-sm font-semibold text-white">
              {strategy.name || "Unnamed Strategy"}
            </span>
            <StatusBadge active={isActive} />
          </div>
          <span className="font-mono text-xs text-white/40">
            {strategy.trading_pair}
          </span>
        </div>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#00D4AA]/10">
          <BotIcon className="size-4 text-[#00D4AA]" />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatChip
          label="Balance"
          value={loading ? "..." : `$${allocatedMargin.toFixed(2)}`}
          loading={loading}
        />
        <StatChip
          label="Pending"
          value={loading ? "..." : `$${pendingMargin.toFixed(2)}`}
          accent="#eab308"
          loading={loading}
        />
        <StatChip
          label="Stop Loss"
          value={loading ? "..." : `${stopLoss}%`}
          accent="#ef4444"
          loading={loading}
        />
        <StatChip
          label="Take Profit"
          value={loading ? "..." : `${takeProfit}%`}
          accent="#22c55e"
          loading={loading}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onViewLogs}
          className="flex-1 cursor-pointer rounded-xl text-white/40 hover:bg-white/[0.06] hover:text-white"
        >
          <ScrollTextIcon className=" size-3.5" />
          View Logs
        </Button>

        {/* Action icons stack */}
        <div className="flex gap-1.5">
          <Tooltip>
            <TooltipTrigger render={
              <Button
                variant="outline"
                size="icon-sm"
                onClick={onSupply}
                className="cursor-pointer rounded-xl border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08]"
              >
                <PlusIcon className="size-4 text-[#00D4AA]" />
              </Button>
            } />
            <TooltipContent>Supply Margin to Subaccount</TooltipContent>
          </Tooltip>

          {!isActive && (
            <Tooltip>
              <TooltipTrigger render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={handleWithdraw}
                  disabled={actionLoading}
                  className="cursor-pointer rounded-xl border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08]"
                >
                  {actionLoading ? <Spinner className="size-3.5" /> : <MinusIcon className="size-4 text-red-400" />}
                </Button>
              } />
              <TooltipContent>Withdraw Margin to Main Wallet</TooltipContent>
            </Tooltip>
          )}
        </div>

        {isActive ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleStop}
            disabled={actionLoading}
            className="cursor-pointer rounded-xl px-3"
          >
            {actionLoading ? (
              <Spinner className=" size-3.5" />
            ) : (
              <SquareIcon className=" size-3.5" />
            )}
            Stop Bot
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleStart}
            disabled={actionLoading}
            className="cursor-pointer rounded-xl bg-gradient-to-r from-[#00D4AA] to-[#0088CC] border-0 text-white px-3"
          >
            {actionLoading ? (
              <Spinner className=" size-3.5" />
            ) : (
              <ActivityIcon className=" size-3.5" />
            )}
            Start Bot
          </Button>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <Badge
      variant="outline"
      className={`h-5 gap-1 text-[10px] ${active
        ? "border-[#00D4AA]/25 bg-[#00D4AA]/8 text-[#00D4AA]"
        : "border-white/10 bg-white/[0.04] text-white/30"
        }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${active ? "animate-pulse bg-[#00D4AA]" : "bg-white/25"}`}
      />
      {active ? "Running" : "Stopped"}
    </Badge>
  )
}

function StatChip({
  label,
  value,
  accent = "#00D4AA",
  loading,
}: {
  label: string
  value: string
  accent?: string
  loading?: boolean
}) {
  return (
    <div className={`flex flex-col gap-0.5 rounded-xl border border-white/[0.04] bg-white/[0.02] p-2 ${loading ? "animate-pulse" : ""}`}>
      <span className="text-[10px] font-medium text-white/30 uppercase tracking-wider">
        {label}
      </span>
      <span
        className="font-mono text-xs font-semibold"
        style={{ color: loading ? "rgba(255,255,255,0.2)" : accent }}
      >
        {value}
      </span>
    </div>
  )
}

// ── Logs Drawer ────────────────────────────────────────────────────────────────

function LogsDrawer({
  strategyId,
  strategyName,
  onClose,
}: {
  strategyId: string
  strategyName: string
  onClose: () => void
}) {
  const [logs, setLogs] = useState<BotLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getBotLogs(strategyId)
      .then(setLogs)
      .catch(() => setLogs([]))
      .finally(() => setLoading(false))
  }, [strategyId])

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-md flex-col border-l border-white/[0.06] bg-[#0a0c12] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.04] px-5 py-4">
          <div className="flex items-center gap-2">
            <ScrollTextIcon className="size-4 text-white/40" />
            <span className="font-medium text-white/80">{strategyName} — Logs</span>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            className="cursor-pointer text-white/30 hover:text-white"
          >
            ✕
          </Button>
        </div>

        {/* Log entries */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner className="size-5 text-white/30" />
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <ActivityIcon className="size-8 text-white/15" />
              <p className="text-sm text-white/30">No logs yet</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {logs.map((log) => (
                <LogEntry key={log.id} log={log} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function LogEntry({ log }: { log: BotLog }) {
  const levelColor: Record<string, string> = {
    INFO: "text-blue-400",
    WARNING: "text-yellow-400",
    ERROR: "text-red-400",
    SUCCESS: "text-[#00D4AA]",
    DEBUG: "text-white/30",
  }
  const color = levelColor[log.level?.toUpperCase()] ?? "text-white/50"

  return (
    <div className="rounded-xl border border-white/[0.04] bg-white/[0.02] px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs font-semibold ${color}`}>{log.level}</span>
        <span className="text-[10px] text-white/25">
          {new Date(log.created_at).toLocaleTimeString()}
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-white/60">{log.message}</p>
    </div>
  )
}
