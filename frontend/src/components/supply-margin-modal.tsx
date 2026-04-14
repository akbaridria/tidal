import { useState } from "react"
import { ArrowDownIcon, WalletIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { depositSubaccountFunds, type Strategy } from "@/lib/api"
import { toast } from "sonner"

interface SupplyMarginModalProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  strategy: Strategy | null
  availableMargin: number
}

export function SupplyMarginModal({
  open,
  onClose,
  onSuccess,
  strategy,
  availableMargin,
}: SupplyMarginModalProps) {
  const [amount, setAmount] = useState("")
  const [submitting, setSubmitting] = useState(false)

  if (!strategy) return null

  async function handleSupply() {
    if (!strategy) return
    const val = parseFloat(amount)
    if (isNaN(val) || val <= 0) {
      toast.error("Invalid amount")
      return
    }
    if (val > availableMargin) {
      toast.error("Amount exceeds available margin")
      return
    }

    setSubmitting(true)
    try {
      await depositSubaccountFunds(strategy.id, val)
      toast.success(`Successfully supplied $${val} to ${strategy.name}`)
      setAmount("")
      onSuccess()
    } catch (error: any) {
      toast.error(error.message || "Failed to supply funds")
    } finally {
      setSubmitting(false)
    }
  }

  function handleMax() {
    setAmount(availableMargin.toString())
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md border-white/[0.06] bg-[#0c0e14] p-0 shadow-2xl overflow-hidden sm:rounded-3xl">
        <DialogHeader className="border-b border-white/[0.04] p-6 pb-4">
          <DialogTitle className="font-heading text-xl text-white">
            Supply Margin
          </DialogTitle>
          <p className="mt-1 text-sm text-white/40">
            Transfer unallocated Pacifica margin straight into {strategy.name}'s isolated subaccount.
          </p>
        </DialogHeader>

        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-white/70">Amount (USDC)</span>
            <div className="flex items-center gap-1.5 text-xs text-white/40">
              <WalletIcon className="size-3.5" />
              Available: ${availableMargin.toFixed(2)}
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
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMax}
              className="absolute right-1 top-1 h-8 px-2 text-xs text-[#00D4AA] hover:bg-[#00D4AA]/10 hover:text-[#00D4AA]"
            >
              MAX
            </Button>
          </div>
        </div>

        <div className="border-t border-white/[0.04] bg-white/[0.01] p-6 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSupply}
            disabled={submitting || !amount || parseFloat(amount) <= 0}
            className="bg-[#00D4AA] text-[#080a0f] hover:bg-[#00D4AA]/90"
          >
            {submitting ? <Spinner className="mr-2" /> : <ArrowDownIcon className="size-4 mr-2" />}
            Confirm Supply
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
