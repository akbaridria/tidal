import { useWallet } from "@solana/wallet-adapter-react"
import {
  ActivityIcon,
  ArrowRightIcon,
  BarChart3Icon,
  BotIcon,
  LayersIcon,
  ShieldCheckIcon,
  TrendingUpIcon,
  WalletIcon,
  ZapIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export function HomePage() {
  const { publicKey, disconnect } = useWallet()

  const truncatedAddress = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`
    : ""

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#080a0f] text-white">
      {/* Background effects */}
      <div className="pointer-events-none absolute inset-0">
        {/* Grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />
        {/* Glow orbs */}
        <div className="absolute -top-40 left-1/4 h-[500px] w-[500px] rounded-full bg-[#00D4AA]/[0.04] blur-[120px]" />
        <div className="absolute top-1/3 -right-20 h-[400px] w-[400px] rounded-full bg-[#0088CC]/[0.05] blur-[100px]" />
        <div className="absolute -bottom-32 left-1/2 h-[300px] w-[300px] rounded-full bg-[#00D4AA]/[0.03] blur-[80px]" />
      </div>

      {/* Navigation */}
      <nav className="relative z-10 flex items-center justify-between border-b border-white/[0.04] px-6 py-4 sm:px-10">
        <div className="flex items-center gap-3">
          <img
            src="/tidal-logo.png"
            alt="Tidal"
            className="h-8 w-8 rounded-lg object-cover"
          />
          <span className="font-heading text-lg font-semibold tracking-tight">
            Tidal
          </span>
          <Badge
            variant="outline"
            className="border-[#00D4AA]/20 bg-[#00D4AA]/5 text-[#00D4AA]"
          >
            Beta
          </Badge>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 sm:flex">
            <WalletIcon className="size-3.5 text-[#00D4AA]" />
            <span className="font-mono text-xs text-white/60">
              {truncatedAddress}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => disconnect()}
            className="cursor-pointer text-white/40 hover:text-white"
          >
            Disconnect
          </Button>
        </div>
      </nav>

      {/* Hero section */}
      <section className="relative z-10 flex flex-col items-center gap-8 px-6 pt-20 pb-16 text-center sm:px-10 sm:pt-28 sm:pb-20">
        <div className="flex flex-col items-center gap-5">
          <Badge
            variant="outline"
            className="border-white/10 bg-white/[0.03] text-white/50"
          >
            <ActivityIcon className="mr-1 size-3" />
            Powered by Pacifica Protocol
          </Badge>

          <h1 className="max-w-2xl bg-gradient-to-b from-white via-white to-white/40 bg-clip-text text-4xl leading-tight font-bold tracking-tight text-transparent sm:text-5xl sm:leading-tight">
            Algorithmic Trading
            <br />
            <span className="bg-gradient-to-r from-[#00D4AA] to-[#0088CC] bg-clip-text text-transparent">
              On Solana
            </span>
          </h1>

          <p className="max-w-lg text-base leading-relaxed text-white/40 sm:text-lg">
            Define technical analysis strategies, deploy automated bots, and
            trade perpetual futures with isolated margin — all on-chain.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            size="lg"
            className="cursor-pointer rounded-2xl border-0 bg-gradient-to-r from-[#00D4AA] to-[#0088CC] px-6 py-5 text-sm font-semibold text-white shadow-lg shadow-[#00D4AA]/15 transition-all duration-300 hover:shadow-xl hover:shadow-[#00D4AA]/25"
          >
            Get Started
            <ArrowRightIcon className="ml-1 size-4" />
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="cursor-pointer rounded-2xl border-white/10 bg-white/[0.03] px-6 py-5 text-sm text-white/70 hover:bg-white/[0.06] hover:text-white"
          >
            View Documentation
          </Button>
        </div>
      </section>

      {/* Stats bar */}
      <section className="relative z-10 mx-auto max-w-4xl px-6 sm:px-10">
        <div className="flex flex-wrap items-center justify-center gap-8 rounded-2xl border border-white/[0.04] bg-white/[0.02] px-8 py-6 sm:gap-16">
          <StatItem label="Protocol" value="Pacifica" />
          <div className="hidden h-8 w-px bg-white/[0.06] sm:block" />
          <StatItem label="Network" value="Solana" />
          <div className="hidden h-8 w-px bg-white/[0.06] sm:block" />
          <StatItem label="Margin" value="Isolated" />
          <div className="hidden h-8 w-px bg-white/[0.06] sm:block" />
          <StatItem label="Execution" value="On-Chain" />
        </div>
      </section>

      {/* Features grid */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 py-20 sm:px-10 sm:py-28">
        <div className="mb-12 flex flex-col items-center gap-3 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            How it works
          </h2>
          <p className="max-w-md text-sm text-white/40">
            A multi-tiered architecture that isolates risk and automates
            execution for every strategy you deploy.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            icon={<TrendingUpIcon className="size-5" />}
            title="Define Strategies"
            description="Choose from technical indicators like RSI, MACD, and Bollinger Bands to build your entry and exit rules."
          />
          <FeatureCard
            icon={<BotIcon className="size-5" />}
            title="Deploy Bots"
            description="Fund a dedicated bot wallet on Solana. Your bot evaluates market data via WebSocket in real-time."
          />
          <FeatureCard
            icon={<ShieldCheckIcon className="size-5" />}
            title="Isolated Margin"
            description="Each strategy runs in its own Pacifica subaccount. One liquidation won't affect your other positions."
          />
          <FeatureCard
            icon={<ZapIcon className="size-5" />}
            title="Auto Execution"
            description="Market orders are executed automatically when your strategy signals trigger, no manual intervention needed."
          />
          <FeatureCard
            icon={<LayersIcon className="size-5" />}
            title="Multi-Strategy"
            description="Run multiple strategies simultaneously on different trading pairs without conflicts."
          />
          <FeatureCard
            icon={<BarChart3Icon className="size-5" />}
            title="Real-time Monitoring"
            description="Track positions, P&L, and strategy performance with live data feeds from Pacifica."
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/[0.04] px-6 py-8 sm:px-10">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-white/25">
            <img
              src="/tidal-logo.png"
              alt="Tidal"
              className="h-5 w-5 rounded object-cover opacity-40"
            />
            Tidal Trading © 2026
          </div>
          <p className="text-xs text-white/20">Built on Solana • Devnet</p>
        </div>
      </footer>
    </div>
  )
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-xs font-medium uppercase tracking-wider text-white/25">
        {label}
      </span>
      <span className="font-heading text-sm font-semibold text-white/80">
        {value}
      </span>
    </div>
  )
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="group flex flex-col gap-4 rounded-2xl border border-white/[0.04] bg-white/[0.015] p-6 transition-all duration-300 hover:border-white/[0.08] hover:bg-white/[0.03]">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#00D4AA]/10 text-[#00D4AA] transition-colors duration-300 group-hover:bg-[#00D4AA]/15">
        {icon}
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className="font-heading text-sm font-semibold text-white/90">
          {title}
        </h3>
        <p className="text-sm leading-relaxed text-white/35">{description}</p>
      </div>
    </div>
  )
}
