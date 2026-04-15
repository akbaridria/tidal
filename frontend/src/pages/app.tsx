import { useCallback, useEffect, useState } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import {
  BanknoteIcon,
  BotIcon,
  HomeIcon,
  WalletIcon,
  LogOutIcon,
  BarChart3Icon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { TreasuryDashboard } from "@/components/treasury-dashboard"
import { ActiveBotsDashboard } from "@/components/active-bots-dashboard"
import { BacktestDashboard } from "@/components/backtest-dashboard"
import { CreateBotModal } from "@/components/create-bot-modal"
import { useAuth } from "@/contexts/auth-context"
import {
  getWalletBalances,
  generateWallet,
  getStrategies,
  getStrategyPresets,
  type StrategyPreset,
  type Strategy,
} from "@/lib/api"

export function AppPage() {
  const { publicKey } = useWallet()
  const { authenticated, authenticating, error: authError, authenticate, logout } = useAuth()

  // ── Wallet balances ──────────────────────────────────────────────────────
  const [balances, setBalances] = useState<Awaited<ReturnType<typeof getWalletBalances>> | null>(null)
  const [balancesLoading, setBalancesLoading] = useState(false)
  const [balancesError, setBalancesError] = useState<string | null>(null)

  // ── Strategies ────────────────────────────────────────────────────────────
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [strategiesLoading, setStrategiesLoading] = useState(false)
  const [strategiesError, setStrategiesError] = useState<string | null>(null)

  // ── Presets ───────────────────────────────────────────────────────────────
  const [presets, setPresets] = useState<StrategyPreset[]>([])
  const [presetsLoading, setPresetsLoading] = useState(false)

  // ── Bot wallet generation ─────────────────────────────────────────────────
  const [generatingWallet, setGeneratingWallet] = useState(false)
  const [botPublicKey, setBotPublicKey] = useState<string | null>(null)

  // ── Create bot modal ──────────────────────────────────────────────────────
  const [createBotOpen, setCreateBotOpen] = useState(false)

  const fetchBalances = useCallback(async () => {
    setBalancesLoading(true)
    setBalancesError(null)
    try {
      const data = await getWalletBalances()
      setBalances(data)
      setBotPublicKey(data.public_key)
    } catch (e) {
      setBalancesError(e instanceof Error ? e.message : "Failed to fetch balances")
    } finally {
      setBalancesLoading(false)
    }
  }, [])

  const fetchStrategies = useCallback(async () => {
    setStrategiesLoading(true)
    setStrategiesError(null)
    try {
      const data = await getStrategies()
      setStrategies(data)
    } catch (e) {
      setStrategiesError(e instanceof Error ? e.message : "Failed to fetch strategies")
    } finally {
      setStrategiesLoading(false)
    }
  }, [])

  const fetchPresets = useCallback(async () => {
    setPresetsLoading(true)
    try {
      const data = await getStrategyPresets()
      setPresets(data)
    } catch {
      setPresets([])
    } finally {
      setPresetsLoading(false)
    }
  }, [])

  // On authenticated, load all data
  useEffect(() => {
    if (authenticated) {
      fetchBalances()
      fetchStrategies()
      fetchPresets()
    }
  }, [authenticated, fetchBalances, fetchStrategies, fetchPresets])

  async function handleGenerateWallet() {
    setGeneratingWallet(true)
    try {
      const { public_key } = await generateWallet()
      setBotPublicKey(public_key)
      await fetchBalances()
    } catch {
      // swallow
    } finally {
      setGeneratingWallet(false)
    }
  }

  const truncatedAddress = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}`
    : ""

  const availableMargin = balances?.pacifica_balance.available_margin_collateral ?? 0

  // ── Auth gate ─────────────────────────────────────────────────────────────
  if (!authenticated) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-[#080a0f] p-4">
        <div className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/[0.06] bg-[#0c0e14] p-8 shadow-2xl">
          <div className="pointer-events-none absolute -top-20 left-1/2 h-40 w-60 -translate-x-1/2 rounded-full bg-[#00D4AA]/8 blur-[80px]" />

          <div className="relative flex flex-col items-center gap-6 text-center">
            <img src="/tidal-logo.png" alt="Tidal" className="h-12 w-12 rounded-xl" />
            <div>
              <h2 className="font-heading text-lg font-semibold text-white">
                Authenticate
              </h2>
              <p className="mt-1.5 text-xs leading-relaxed text-white/40">
                Sign a message with your wallet to prove ownership and access
                the Tidal platform.
              </p>
            </div>

            <div className="flex w-full items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
              <WalletIcon className="size-3.5 shrink-0 text-[#00D4AA]" />
              <span className="font-mono text-xs text-white/60">{truncatedAddress}</span>
            </div>

            {authError && (
              <p className="w-full rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
                {authError}
              </p>
            )}

            <Button
              onClick={authenticate}
              disabled={authenticating}
              className="w-full cursor-pointer rounded-xl border-0 bg-gradient-to-r from-[#00D4AA] to-[#0088CC] py-5 text-white"
            >
              {authenticating && <Spinner className="mr-2" />}
              {authenticating ? "Signing…" : "Sign & Authenticate"}
            </Button>

            <button
              onClick={logout}
              className="cursor-pointer text-xs text-white/25 hover:text-white/50"
            >
              Disconnect wallet
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Main app ──────────────────────────────────────────────────────────────
  return (
    <div className="relative min-h-svh bg-[#080a0f]">
      {/* Background */}
      <div className="pointer-events-none fixed inset-0">
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />
        <div className="absolute -top-40 left-1/4 h-[400px] w-[400px] rounded-full bg-[#00D4AA]/[0.03] blur-[100px]" />
        <div className="absolute top-1/2 -right-20 h-[300px] w-[300px] rounded-full bg-[#0088CC]/[0.04] blur-[80px]" />
      </div>

      {/* Navigation */}
      <nav className="relative z-10 flex items-center justify-between border-b border-white/[0.04] px-5 py-3.5 sm:px-8">
        <div className="flex items-center gap-3">
          <img src="/tidal-logo.png" alt="Tidal" className="h-7 w-7 rounded-lg" />
          <span className="font-heading font-semibold text-white">Tidal</span>
          <Badge
            variant="outline"
            className="border-[#00D4AA]/20 bg-[#00D4AA]/5 text-[#00D4AA]"
          >
            Beta
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 sm:flex">
            <WalletIcon className="size-3.5 text-[#00D4AA]" />
            <span className="font-mono text-xs text-white/50">{truncatedAddress}</span>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={logout}
            className="cursor-pointer text-white/30 hover:text-white"
          >
            <LogOutIcon className="size-4" />
          </Button>
        </div>
      </nav>

      {/* Main content */}
      <main className="relative z-10 mx-auto max-w-4xl px-5 py-8 sm:px-8">
        <Tabs defaultValue="treasury" className="w-full">
          <TabsList className="mb-6 border border-white/[0.04] bg-white/[0.02]">
            <TabsTrigger value="overview" className="gap-1.5">
              <HomeIcon className="size-3.5" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="treasury" className="gap-1.5">
              <BanknoteIcon className="size-3.5" />
              Treasury
            </TabsTrigger>
            <TabsTrigger value="bots" className="gap-1.5">
              <BotIcon className="size-3.5" />
              Bots
              {strategies.filter((s) => s.is_active !== false).length > 0 && (
                <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#00D4AA]/20 px-1 text-[10px] font-semibold text-[#00D4AA]">
                  {strategies.filter((s) => s.is_active !== false).length}
                </span>
              )}
            </TabsTrigger>
          <TabsTrigger value="backtest" className="gap-1.5">
            <BarChart3Icon className="size-3.5" />
            Backtest
          </TabsTrigger>
        </TabsList>

        {/* Overview tab */}
        <TabsContent value="overview">
          <OverviewTab
            balances={balances}
            strategies={strategies}
            hasBotWallet={!!botPublicKey}
            onGoToTreasury={() => document.querySelector<HTMLButtonElement>('[data-value="treasury"]')?.click()}
            onLaunchBot={() => setCreateBotOpen(true)}
          />
        </TabsContent>

        {/* Treasury tab */}
        <TabsContent value="treasury">
          <TreasuryDashboard
            balances={balances}
            loading={balancesLoading}
            error={balancesError}
            onRefresh={fetchBalances}
            botPublicKey={botPublicKey}
            onGenerateWallet={handleGenerateWallet}
            generatingWallet={generatingWallet}
          />
        </TabsContent>

        {/* Bots tab */}
        <TabsContent value="bots">
          <ActiveBotsDashboard
            strategies={strategies}
            loading={strategiesLoading}
            error={strategiesError}
            onRefresh={fetchStrategies}
            onLaunchBot={() => setCreateBotOpen(true)}
            availableMargin={availableMargin}
            hasBotWallet={!!botPublicKey}
          />
        </TabsContent>

        {/* Backtest tab */}
        <TabsContent value="backtest">
          <BacktestDashboard />
        </TabsContent>
      </Tabs>
    </main>

      {/* Create Bot Modal */ }
  <CreateBotModal
    open={createBotOpen}
    onClose={() => setCreateBotOpen(false)}
    onSuccess={() => {
      setCreateBotOpen(false)
      fetchStrategies()
    }}
    presets={presets}
    loadingPresets={presetsLoading}
    availableMargin={availableMargin}
  />
    </div >
  )
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({
  balances,
  strategies,
  onGoToTreasury: _onGoToTreasury,
  onLaunchBot,
  hasBotWallet,
}: {
  balances: Awaited<ReturnType<typeof getWalletBalances>> | null
  strategies: Strategy[]
  onGoToTreasury: () => void
  onLaunchBot: () => void
  hasBotWallet: boolean
}) {
  const activeCount = strategies.filter((s) => s.is_active !== false).length
  const onChain = balances?.user_wallet_balance.usdc ?? 0
  const inPacifica = balances?.pacifica_balance.available_margin_collateral ?? 0

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <OverviewCard
          icon={<BanknoteIcon className="size-5" />}
          label="On-Chain USDC"
          value={`$${onChain.toFixed(2)}`}
          accent="#00D4AA"
        />
        <OverviewCard
          icon={<BanknoteIcon className="size-5" />}
          label="Pacifica Margin"
          value={`$${inPacifica.toFixed(2)}`}
          accent="#0088CC"
        />
        <OverviewCard
          icon={<BotIcon className="size-5" />}
          label="Active Bots"
          value={String(activeCount)}
          accent="#a855f7"
        />
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-white/[0.04] bg-white/[0.015] p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-heading text-base font-semibold text-white">
            Ready to trade?
          </h3>
          <p className="mt-1 text-sm text-white/40">
            Fund your treasury then launch an automated bot.
          </p>
        </div>
        <Button
          onClick={onLaunchBot}
          disabled={!hasBotWallet}
          className="cursor-pointer shrink-0 rounded-xl border-0 bg-gradient-to-r from-[#00D4AA] to-[#0088CC] text-white disabled:opacity-30 disabled:grayscale"
        >
          <BotIcon className="mr-2 size-4" />
          {hasBotWallet ? "Launch New Bot" : "Generate Wallet to Launch"}
        </Button>
      </div>
    </div>
  )
}

function OverviewCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  accent: string
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.04] bg-white/[0.015] p-5">
      <div
        className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full blur-2xl"
        style={{ backgroundColor: accent, opacity: 0.07 }}
      />
      <div
        className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl"
        style={{ backgroundColor: `${accent}15`, color: accent }}
      >
        {icon}
      </div>
      <p className="text-2xl font-semibold tabular-nums text-white">{value}</p>
      <p className="mt-0.5 text-xs text-white/40">{label}</p>
    </div>
  )
}
