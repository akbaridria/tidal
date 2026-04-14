import { useWallet } from "@solana/wallet-adapter-react"
import { useWalletModal } from "@solana/wallet-adapter-react-ui"
import { WavesIcon, ShieldCheckIcon, ZapIcon, BotIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export function ConnectWalletModal() {
  const { connected } = useWallet()
  const { setVisible } = useWalletModal()

  if (connected) return null

  return (
    <>
      {/* Backdrop — covers entire viewport, not dismissible */}
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md" />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/[0.06] bg-[#0c0e14] shadow-2xl shadow-black/50">
          {/* Decorative glow */}
          <div className="pointer-events-none absolute -top-32 left-1/2 h-64 w-96 -translate-x-1/2 rounded-full bg-[#00D4AA]/10 blur-[100px]" />
          <div className="pointer-events-none absolute -bottom-20 right-0 h-40 w-60 rounded-full bg-[#0088CC]/10 blur-[80px]" />

          {/* Content */}
          <div className="relative flex flex-col items-center gap-8 px-8 py-10 sm:px-10 sm:py-12">
            {/* Logo + Project identity */}
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <div className="absolute inset-0 animate-pulse rounded-2xl bg-[#00D4AA]/20 blur-xl" />
                <img
                  src="/tidal-logo.png"
                  alt="Tidal Trading"
                  className="relative h-16 w-16 rounded-2xl object-cover"
                />
              </div>

              <div className="flex flex-col items-center gap-2">
                <h1 className="bg-gradient-to-r from-white via-white to-white/60 bg-clip-text font-heading text-2xl font-semibold tracking-tight text-transparent">
                  Tidal Trading
                </h1>
                <Badge
                  variant="outline"
                  className="border-[#00D4AA]/30 bg-[#00D4AA]/5 text-[#00D4AA]"
                >
                  <span className="relative mr-1 flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00D4AA] opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#00D4AA]" />
                  </span>
                  Live on Devnet
                </Badge>
              </div>

              <p className="max-w-xs text-center text-sm leading-relaxed text-white/50">
                Algorithmic perpetual futures trading on Solana.
                Define strategies, deploy bots, trade automatically.
              </p>
            </div>

            {/* Feature pills */}
            <div className="grid w-full grid-cols-3 gap-3">
              <FeaturePill
                icon={<BotIcon className="size-4" />}
                label="Auto Trading"
              />
              <FeaturePill
                icon={<ShieldCheckIcon className="size-4" />}
                label="Isolated Risk"
              />
              <FeaturePill
                icon={<ZapIcon className="size-4" />}
                label="On-Chain"
              />
            </div>

            {/* Divider */}
            <div className="flex w-full items-center gap-3">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent to-white/10" />
              <span className="text-xs font-medium uppercase tracking-widest text-white/25">
                Connect to continue
              </span>
              <div className="h-px flex-1 bg-gradient-to-l from-transparent to-white/10" />
            </div>

            {/* Connect button */}
            <Button
              size="lg"
              onClick={() => setVisible(true)}
              className="group relative w-full cursor-pointer overflow-hidden rounded-2xl border-0 bg-gradient-to-r from-[#00D4AA] to-[#0088CC] py-6 text-base font-semibold text-white shadow-lg shadow-[#00D4AA]/20 transition-all duration-300 hover:shadow-xl hover:shadow-[#00D4AA]/30"
            >
              <WavesIcon className="mr-2 size-5 transition-transform duration-300 group-hover:rotate-12" />
              Connect Solana Wallet
              <div className="absolute inset-0 bg-white/0 transition-all duration-300 group-hover:bg-white/10" />
            </Button>

            {/* Supported wallets hint */}
            <p className="text-xs text-white/30">
              Supports Phantom, Solflare &amp; more
            </p>
          </div>
        </div>
      </div>
    </>
  )
}

function FeaturePill({
  icon,
  label,
}: {
  icon: React.ReactNode
  label: string
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3 py-4 text-center transition-colors hover:bg-white/[0.04]">
      <div className="text-[#00D4AA]">{icon}</div>
      <span className="text-xs font-medium text-white/60">{label}</span>
    </div>
  )
}
