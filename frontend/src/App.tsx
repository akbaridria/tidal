import { useWallet } from "@solana/wallet-adapter-react"
import { SolanaWalletProvider } from "@/contexts/wallet-context"
import { AuthProvider } from "@/contexts/auth-context"
import { ConnectWalletModal } from "@/components/connect-wallet-modal"
import { AppPage } from "@/pages/app"
import { HomePage } from "@/pages/home"
import { TooltipProvider } from "./components/ui/tooltip"
import { Toaster } from "./components/ui/sonner"

function AppInner() {
  const { connected } = useWallet()

  return (
    <>
      {/* Unclosable connect modal when not connected */}
      <ConnectWalletModal />

      {/* Content */}
      {connected ? <AppPage /> : <HomePage />}
    </>
  )
}

export function App() {
  return (
    <SolanaWalletProvider>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <AppInner />
        </TooltipProvider>
      </AuthProvider>
    </SolanaWalletProvider>
  )
}

export default App
