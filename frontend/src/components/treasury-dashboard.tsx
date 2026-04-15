import { useEffect, useState } from "react"
import {
  BanknoteIcon,
  RefreshCwIcon,
  WalletIcon,
  PlusIcon,
  MinusIcon,
  AlertCircleIcon,
  ActivityIcon,
  CopyIcon,
  SendIcon,
} from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useConnection, useWallet } from "@solana/wallet-adapter-react"
import { PublicKey, Transaction } from "@solana/web3.js"
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token"
import { depositToPacifica, withdrawFromPacifica, withdrawToUser, getAccountSettings, updateLeverage } from "@/lib/api"
import type { getWalletBalances } from "@/lib/api"
import { TRADING_PAIRS } from "@/lib/constants"
import { toast } from "sonner"

const USDC_MINT = new PublicKey("USDPqRbLidFGufty2s3oizmDEKdqx7ePTqzDMbf5ZKM")

type Balances = Awaited<ReturnType<typeof getWalletBalances>>

interface TreasuryDashboardProps {
  balances: Balances | null
  loading: boolean
  error: string | null
  onRefresh: () => void
  botPublicKey: string | null
  onGenerateWallet: () => void
  generatingWallet: boolean
}

export function TreasuryDashboard({
  balances,
  loading,
  error,
  onRefresh,
  botPublicKey,
  onGenerateWallet,
  generatingWallet,
}: TreasuryDashboardProps) {
  // Modal states
  const [showDepositBotModal, setShowDepositBotModal] = useState(false)
  const [showTransferUserModal, setShowTransferUserModal] = useState(false)
  const [showTransferPacificaModal, setShowTransferPacificaModal] = useState(false)
  const [showWithdrawPacificaModal, setShowWithdrawPacificaModal] = useState(false)

  const [leverageSettings, setLeverageSettings] = useState<any[]>([])
  const [loadingLeverage, setLoadingLeverage] = useState(false)
  const [leverageSymbol, setLeverageSymbol] = useState(TRADING_PAIRS[0].symbol)
  const [newLeverage, setNewLeverage] = useState("10")
  const [isIsolated, setIsIsolated] = useState(false)
  const [updatingLeverage, setUpdatingLeverage] = useState(false)

  const { connection } = useConnection()
  const [rpcSolBalance, setRpcSolBalance] = useState<number | null>(null)

  useEffect(() => {
    if (botPublicKey) {
      connection.getBalance(new PublicKey(botPublicKey))
        .then(bal => setRpcSolBalance(bal / 1e9))
        .catch(err => console.error("Failed to fetch live SOL balance", err))
    }
  }, [botPublicKey, connection, onRefresh])

  useEffect(() => {
    if (botPublicKey) {
      setLoadingLeverage(true)
      getAccountSettings()
        .then(res => {
          const settings = res.margin_settings || []
          setLeverageSettings(settings)

          // Auto-sync current symbol values
          const active = settings.find((s: any) => s.symbol === leverageSymbol)
          if (active) {
            setNewLeverage(active.leverage.toString())
            setIsIsolated(active.isolated)
          } else {
            setNewLeverage("0")
            setIsIsolated(false)
          }
        })
        .catch(() => { })
        .finally(() => setLoadingLeverage(false))
    }
  }, [botPublicKey, onRefresh, leverageSymbol])

  async function handleUpdateLeverage() {
    const lev = parseInt(newLeverage) || 0
    const currentPair = TRADING_PAIRS.find(p => p.symbol === leverageSymbol)
    const maxAllowed = currentPair?.maxLeverage ?? 50

    if (lev > maxAllowed) {
      toast.error(`Maximum leverage for ${leverageSymbol} is ${maxAllowed}x`)
      return
    }
    setUpdatingLeverage(true)
    try {
      await updateLeverage(leverageSymbol, lev, isIsolated)
      onRefresh()
      toast.success("Settings updated")
    } catch (e: any) {
      toast.error(e.message || "Update failed")
    } finally {
      setUpdatingLeverage(false)
    }
  }

  function copyAddress() {
    if (balances?.public_key) {
      navigator.clipboard.writeText(balances.public_key)
      toast.success("Address copied to clipboard")
    }
  }

  const onChainBalance = balances?.user_wallet_balance.usdc ?? 0
  const pacificaBalance =
    balances?.pacifica_balance.available_margin_collateral ?? 0

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1.5">
            <h2 className="font-heading text-xl font-semibold text-white">
              Bot Treasury
            </h2>
            {botPublicKey && (
              <div className="flex items-center gap-2 group">
                <span className="text-[10px] font-mono text-white/30 truncate max-w-[150px] sm:max-w-none">
                  {botPublicKey}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={copyAddress}
                  className="h-5 w-5 text-white/20 hover:text-[#00D4AA] opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <CopyIcon className="size-2.5" />
                </Button>
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onRefresh}
            disabled={loading}
            className="cursor-pointer text-white/40 hover:text-white"
          >
            <RefreshCwIcon className={loading ? "animate-spin" : ""} />
          </Button>
        </div>

        {/* No wallet state */}
        {!botPublicKey && !loading && (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#00D4AA]/10 text-[#00D4AA]">
              <WalletIcon className="size-5" />
            </div>
            <div>
              <p className="font-medium text-white/70">No Bot Wallet Found</p>
              <p className="mt-1 text-sm text-white/35">
                Generate a dedicated bot wallet to start trading
              </p>
            </div>
            <Button
              onClick={onGenerateWallet}
              disabled={generatingWallet}
              className="cursor-pointer rounded-xl border-0 bg-gradient-to-r from-[#00D4AA] to-[#0088CC] text-white"
            >
              {generatingWallet ? (
                <Spinner className="mr-2" />
              ) : (
                <PlusIcon className="mr-2 size-4" />
              )}
              Generate Bot Wallet
            </Button>
          </div>
        )}

        {/* Error */}
        {error && botPublicKey && (
          <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
            <AlertCircleIcon className="size-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Low SOL Warning */}
        {balances && (rpcSolBalance ?? balances.bot_wallet_balance.sol) < 0.005 && !loading && (
          <div className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-200/80">
            <AlertCircleIcon className="size-4 shrink-0 text-amber-500" />
            <div className="flex flex-col gap-0.5">
              <p className="font-medium text-amber-400">Low SOL Balance for Fees</p>
              <p className="opacity-70">
                Your bot wallet has {(rpcSolBalance ?? balances.bot_wallet_balance.sol).toFixed(4)} SOL. You need a small amount of SOL (at least 0.01 Recommended) to pay for transaction fees when depositing or trading.
              </p>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-10">
            <Spinner className="size-6 text-white/30" />
          </div>
        )}

        {/* Balance cards */}
        {balances && !loading && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <BalanceCard
                icon={<BanknoteIcon className="size-5" />}
                label="On-Chain"
                sublabel="User Wallet"
                value={onChainBalance}
                accent="#00D4AA"
              />
              <BalanceCard
                icon={<WalletIcon className="size-5" />}
                label="Bot Treasury"
                sublabel={`${(rpcSolBalance ?? balances.bot_wallet_balance.sol).toFixed(4)} SOL for fees`}
                value={balances.bot_wallet_balance.usdc}
                accent="#0088CC"
                actions={
                  <div className="flex gap-1.5">
                    <ActionButton icon={<PlusIcon className="size-3.5" />} onClick={() => setShowDepositBotModal(true)} tooltip="Deposit from Personal Wallet" accent="#00D4AA" />
                    <ActionButton icon={<MinusIcon className="size-3.5" />} onClick={() => setShowTransferUserModal(true)} tooltip="Withdraw to Personal Wallet" />
                  </div>
                }
              />
              <BalanceCard
                icon={<ActivityIcon className="size-5" />}
                label="Trading Margin"
                sublabel="Pacifica Account"
                value={pacificaBalance}
                accent="#FF9E2C"
                actions={
                  <div className="flex gap-1.5">
                    <ActionButton icon={<PlusIcon className="size-3.5" />} onClick={() => setShowTransferPacificaModal(true)} tooltip="Supply to Trading Account" accent="#FF9E2C" />
                    <ActionButton icon={<MinusIcon className="size-3.5" />} onClick={() => setShowWithdrawPacificaModal(true)} tooltip="Withdraw to Bot Treasury" />
                  </div>
                }
              />
            </div>

            {/* Leverage Management */}
            <div className="rounded-2xl border border-white/[0.04] bg-white/[0.02] p-5">
              <h3 className="mb-1 text-sm font-medium text-white/80 flex items-center gap-2">
                <ActivityIcon className="size-4 text-[#00D4AA]" />
                Account Leverage Settings
              </h3>
              <p className="mb-4 text-xs text-white/35">
                Adjust your bot wallet leverage for specific trading pairs. Unconfigured pairs use the Pacifica Max default.
              </p>
              <div className="flex gap-3 items-end mb-5">
                <div className="flex flex-col gap-1.5 w-1/3">
                  <label className="text-[10px] uppercase font-medium text-white/30 tracking-wider">Trading Pair</label>
                  <Select value={leverageSymbol} onValueChange={(val) => val && setLeverageSymbol(val)}>
                    <SelectTrigger className="h-9 rounded-xl border-white/[0.06] bg-white/[0.04] text-xs w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRADING_PAIRS.map(p => (
                        <SelectItem key={p.symbol} value={p.symbol}>{p.symbol}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5 w-1/4">
                  <label className="text-[10px] uppercase font-medium text-white/30 tracking-wider">Leverage</label>
                  <div className="relative">
                    <Input
                      type="number"
                      min={0}
                      max={TRADING_PAIRS.find(p => p.symbol === leverageSymbol)?.maxLeverage ?? 50}
                      value={newLeverage}
                      onChange={e => setNewLeverage(e.target.value)}
                      className="h-9 pr-6 font-mono text-xs"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-white/20">x</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-[10px] uppercase font-medium text-white/30 tracking-wider">Margin Mode</label>
                  <div className="flex h-9 rounded-xl border border-white/[0.04] bg-white/[0.01] p-1">
                    <button
                      onClick={() => setIsIsolated(false)}
                      className={`flex-1 rounded-lg text-[10px] font-medium transition-all ${!isIsolated ? "bg-white/[0.1] text-[#00D4AA]" : "text-white/30 hover:text-white"}`}
                    >
                      Cross
                    </button>
                    <button
                      onClick={() => setIsIsolated(true)}
                      className={`flex-1 rounded-lg text-[10px] font-medium transition-all ${isIsolated ? "bg-white/[0.1] text-[#00D4AA]" : "text-white/30 hover:text-white"}`}
                    >
                      Isolated
                    </button>
                  </div>
                </div>

                <Button onClick={handleUpdateLeverage} disabled={updatingLeverage} variant="outline" className="h-9 px-6 rounded-xl cursor-pointer border-[#00D4AA]/20 hover:border-[#00D4AA]/40 text-[#00D4AA] text-xs">
                  {updatingLeverage ? <Spinner className="size-3" /> : "Apply Settings"}
                </Button>
              </div>

              {loadingLeverage ? (
                <Spinner className="size-4 text-white/30" />
              ) : leverageSettings.length > 0 ? (
                <div className="rounded-xl overflow-hidden border border-white/[0.04] bg-white/[0.01]">
                  <div className="grid grid-cols-3 bg-white/[0.04] px-4 py-2 text-[10px] font-semibold tracking-wider text-white/40 uppercase relative">
                    <div>Symbol</div>
                    <div>Leverage</div>
                    <div>Margin Mode</div>
                  </div>
                  {leverageSettings.map(s => (
                    <div key={s.symbol} className="grid grid-cols-3 px-4 py-2.5 text-xs text-white/70 border-t border-white/[0.04]">
                      <span className="font-mono">{s.symbol}</span>
                      <span>{s.leverage}x</span>
                      <span>{s.isolated ? "Isolated" : "Cross"}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] px-4 py-3">
                  <p className="text-xs text-white/30 italic">All pairs at default (Cross Margin + Max Leverage).</p>
                </div>
              )}
            </div>
            {/* Modals */}
            {balances && (
              <>
                <DepositToBotWalletModal
                  open={showDepositBotModal}
                  onClose={() => setShowDepositBotModal(false)}
                  botAddress={balances.public_key}
                  userBalance={balances.user_wallet_balance.usdc}
                  onRefresh={onRefresh}
                />
                <TransferToUserModal
                  open={showTransferUserModal}
                  onClose={() => setShowTransferUserModal(false)}
                  onRefresh={onRefresh}
                  maxAmount={balances.bot_wallet_balance.usdc}
                />
                <TransferToPacificaModal
                  open={showTransferPacificaModal}
                  onClose={() => setShowTransferPacificaModal(false)}
                  onRefresh={onRefresh}
                  maxAmount={balances.bot_wallet_balance.usdc}
                />
                <WithdrawFromPacificaModal
                  open={showWithdrawPacificaModal}
                  onClose={() => setShowWithdrawPacificaModal(false)}
                  onRefresh={onRefresh}
                  maxAmount={pacificaBalance}
                />
              </>
            )}
          </>
        )}
      </div>
    </TooltipProvider>
  )
}

function BalanceCard({
  icon,
  label,
  sublabel,
  value,
  accent,
  actions
}: {
  icon: React.ReactNode
  label: string
  sublabel: string
  value: number
  accent: string
  actions?: React.ReactNode
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/[0.04] bg-white/[0.015] p-5 transition-colors hover:border-white/[0.08]">
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl transition-opacity group-hover:opacity-100"
        style={{ backgroundColor: accent, opacity: 0.06 }}
      />
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${accent}18`, color: accent }}
          >
            {icon}
          </div>
          {actions}
        </div>
        <div>
          <p className="text-2xl font-semibold tubular-nums tracking-tight text-white line-clamp-1">
            ${value.toFixed(2)}
          </p>
          <div className="flex flex-col mt-0.5">
            <p className="text-xs font-medium text-white/40">{label}</p>
            <p className="text-[10px] text-white/20">{sublabel}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function ActionButton({ icon, onClick, tooltip, accent }: { icon: React.ReactNode, onClick: () => void, tooltip: string, accent?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={
        <Button
          variant="ghost"
          size="icon"
          onClick={onClick}
          className="h-8 w-8 rounded-lg bg-white/[0.03] text-white/30 hover:bg-white/[0.06] hover:text-white transition-all selection:bg-none"
          style={accent ? { color: `${accent}cc` } : {}}
        >
          {icon}
        </Button>
      } />
      <TooltipContent className="text-[10px]">{tooltip}</TooltipContent>
    </Tooltip>
  )
}

function DepositToBotWalletModal({
  open,
  onClose,
  botAddress,
  userBalance,
  onRefresh
}: {
  open: boolean,
  onClose: () => void,
  botAddress: string,
  userBalance: number,
  onRefresh: () => void
}) {
  const { connection } = useConnection()
  const { publicKey, sendTransaction } = useWallet()
  const [amount, setAmount] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleDeposit() {
    if (!publicKey || !amount) return
    const val = parseFloat(amount)
    if (isNaN(val) || val <= 0) {
      toast.error("Invalid amount")
      return
    }

    setLoading(true)
    try {
      const destinationPubkey = new PublicKey(botAddress)

      // Get ATAs
      const sourceATA = await getAssociatedTokenAddress(USDC_MINT, publicKey)
      const destATA = await getAssociatedTokenAddress(USDC_MINT, destinationPubkey)

      const transaction = new Transaction()

      // Check if destination ATA exists, if not create it
      const destAccountInfo = await connection.getAccountInfo(destATA)
      if (!destAccountInfo) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            destATA,
            destinationPubkey,
            USDC_MINT
          )
        )
      }

      // Add transfer instruction
      transaction.add(
        createTransferInstruction(
          sourceATA,
          destATA,
          publicKey,
          Math.floor(val * 1_000_000), // 6 decimals
          [],
          TOKEN_PROGRAM_ID
        )
      )

      const signature = await sendTransaction(transaction, connection)
      toast.info("Transaction sent... waiting for confirmation")

      const latestBlockhash = await connection.getLatestBlockhash()
      await connection.confirmTransaction({
        signature,
        ...latestBlockhash
      })

      toast.success(`Successfully deposited $${val} to bot wallet`)
      setAmount("")
      onRefresh()
      onClose()
    } catch (e: any) {
      console.error("Deposit error:", e)
      toast.error(e.message || "Deposit failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md border-white/[0.06] bg-[#0c0e14] p-0 shadow-2xl overflow-hidden sm:rounded-3xl">
        <DialogHeader className="border-b border-white/[0.04] p-6 pb-4">
          <DialogTitle className="font-heading text-xl text-white">Deposit USDC</DialogTitle>
          <p className="mt-1 text-sm text-white/40">Fund your bot treasury directly from your connected wallet.</p>
        </DialogHeader>

        <div className="p-6 flex flex-col gap-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-medium uppercase tracking-wider text-white/30">Amount to Deposit</span>
              <div className="flex items-center gap-1.5 text-xs text-white/40">
                <BanknoteIcon className="size-3" />
                Available: ${userBalance.toFixed(2)}
              </div>
            </div>

            <div className="relative">
              <Input
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="pr-16 text-lg font-mono border-white/10 bg-white/[0.02]"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-medium text-white/20">USDC</span>
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-4 text-[11px] leading-relaxed text-white/40">
            <p>You are sending USDC from your personal wallet to the bot's unallocated on-chain treasury address:</p>
            <p className="mt-2 font-mono text-[10px] text-[#00D4AA]/70 break-all">{botAddress}</p>
          </div>
        </div>

        <div className="border-t border-white/[0.04] bg-white/[0.01] p-6 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button
            onClick={handleDeposit}
            disabled={loading || !amount || !publicKey}
            className="bg-[#00D4AA] text-black hover:bg-[#00D4AA]/90 min-w-[140px] rounded-xl flex items-center justify-center gap-2"
          >
            {loading ? <Spinner className="size-4" /> : <PlusIcon className="size-4" />}
            Confirm Deposit
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function TransferToUserModal({ open, onClose, onRefresh, maxAmount }: { open: boolean, onClose: () => void, onRefresh: () => void, maxAmount: number }) {
  const { publicKey } = useWallet()
  const [amount, setAmount] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleWithdraw() {
    if (!publicKey) {
      toast.error("Wallet not connected")
      return
    }
    const val = parseFloat(amount)
    if (isNaN(val) || val <= 0) {
      toast.error("Invalid amount")
      return
    }
    setLoading(true)
    try {
      await withdrawToUser(val, publicKey.toBase58())
      toast.success("Transfer initiated")
      onRefresh()
      onClose()
    } catch (e: any) {
      toast.error(e.message || "Withdrawal failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md border-white/[0.06] bg-[#0c0e14] p-0 shadow-2xl overflow-hidden sm:rounded-3xl">
        <DialogHeader className="border-b border-white/[0.04] p-6 pb-4">
          <DialogTitle className="font-heading text-xl text-white">Withdraw to Personal Wallet</DialogTitle>
          <p className="mt-1 text-sm text-white/40">Send USDC from the bot treasury back to your main bag.</p>
        </DialogHeader>
        <div className="p-6 flex flex-col gap-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-[10px] uppercase font-medium text-white/30 tracking-wider">
              <span>Amount to Withdraw</span>
              <span>Available: ${maxAmount.toFixed(2)}</span>
            </div>
            <div className="relative">
              <Input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} className="pr-12 font-mono text-lg" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-white/20">USDC</span>
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-4 text-[11px] leading-relaxed text-white/40">
            <p>Funds will be withdrawn from the bot treasury and sent back to your connected personal wallet:</p>
            <p className="mt-2 font-mono text-[10px] text-[#00D4AA]/70 break-all">{publicKey?.toBase58()}</p>
          </div>
        </div>
        <div className="border-t border-white/[0.04] bg-white/[0.01] p-6 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleWithdraw} disabled={loading || !amount} className="bg-white text-black hover:bg-white/90 min-w-[140px] rounded-xl flex items-center justify-center gap-2"
          >
            {loading ? <Spinner className="size-4" /> : <SendIcon className="size-4" />}
            Send Funds
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function TransferToPacificaModal({ open, onClose, onRefresh, maxAmount }: { open: boolean, onClose: () => void, onRefresh: () => void, maxAmount: number }) {
  const [amount, setAmount] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleTransfer() {
    const val = parseFloat(amount)
    if (isNaN(val) || val <= 0) {
      toast.error("Invalid amount")
      return
    }
    setLoading(true)
    try {
      await depositToPacifica(val)
      toast.success("Funds supplied to trading account")
      onRefresh()
      onClose()
    } catch (e: any) {
      toast.error(e.message || "Supply failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm border-white/[0.06] bg-[#0c0e14] p-0 shadow-2xl overflow-hidden sm:rounded-3xl">
        <DialogHeader className="border-b border-white/[0.04] p-6 pb-4">
          <DialogTitle className="font-heading text-lg text-white">Supply Trading Margin</DialogTitle>
          <p className="mt-1 text-xs text-white/40">Move funds from Bot Treasury into Pacifica.</p>
        </DialogHeader>
        <div className="p-6 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] uppercase font-medium text-white/30 tracking-wider">
              <span>Amount to Supply</span>
              <span>Available: ${maxAmount.toFixed(2)}</span>
            </div>
            <div className="relative">
              <Input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} className="pr-12 font-mono text-sm" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-white/20">USDC</span>
            </div>
          </div>
        </div>
        <div className="border-t border-white/[0.04] bg-white/[0.01] p-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button onClick={handleTransfer} disabled={loading || !amount} className="bg-[#FF9E2C] text-black hover:bg-[#FF9E2C]/90 rounded-xl px-6">
            {loading ? <Spinner className="size-3.5" /> : "Confirm Supply"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function WithdrawFromPacificaModal({ open, onClose, onRefresh, maxAmount }: { open: boolean, onClose: () => void, onRefresh: () => void, maxAmount: number }) {
  const [amount, setAmount] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleWithdraw() {
    const val = parseFloat(amount)
    if (isNaN(val) || val <= 0) {
      toast.error("Invalid amount")
      return
    }
    setLoading(true)
    try {
      await withdrawFromPacifica(val)
      toast.success("Funds withdrawn to Bot Treasury")
      onRefresh()
      onClose()
    } catch (e: any) {
      toast.error(e.message || "Withdrawal failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm border-white/[0.06] bg-[#0c0e14] p-0 shadow-2xl overflow-hidden sm:rounded-3xl">
        <DialogHeader className="border-b border-white/[0.04] p-6 pb-4">
          <DialogTitle className="font-heading text-lg text-white">Withdraw Margin</DialogTitle>
          <p className="mt-1 text-xs text-white/40">Move funds from Pacifica back to your Bot Treasury.</p>
        </DialogHeader>
        <div className="p-6 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] uppercase font-medium text-white/30 tracking-wider">
              <span>Amount to Withdraw</span>
              <span>Available: ${maxAmount.toFixed(2)}</span>
            </div>
            <div className="relative">
              <Input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} className="pr-12 font-mono text-sm" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-white/20">USDP</span>
            </div>
          </div>
        </div>
        <div className="border-t border-white/[0.04] bg-white/[0.01] p-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button onClick={handleWithdraw} disabled={loading || !amount} className="bg-white text-black hover:bg-white/90 rounded-xl px-6">
            {loading ? <Spinner className="size-3.5" /> : "Withdraw Funds"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
