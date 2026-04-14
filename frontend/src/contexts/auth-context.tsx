import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import bs58 from "bs58"
import { getChallenge, login, setToken, clearToken } from "@/lib/api"
import { getCookie, getJwtPubkey, isJwtValid } from "@/lib/cookies"

interface AuthState {
  authenticated: boolean
  authenticating: boolean
  error: string | null
  authenticate: () => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { publicKey, signMessage, disconnect, connected } = useWallet()
  const [authenticated, setAuthenticated] = useState(false)
  const [authenticating, setAuthenticating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Track the previous wallet pubkey so we can detect a wallet switch
  const prevPubkeyRef = useRef<string | null>(null)

  // ── On wallet connect / change ─────────────────────────────────────────────
  useEffect(() => {
    if (!connected || !publicKey) {
      // Wallet disconnected — clear state, but keep cookie so same wallet
      // can restore without re-signing on reconnect.
      setAuthenticated(false)
      return
    }

    const currentPubkey = publicKey.toBase58()
    const prev = prevPubkeyRef.current

    // Wallet was switched to a different address
    if (prev !== null && prev !== currentPubkey) {
      // Invalidate old session — its JWT belongs to the previous wallet
      clearToken()
      setAuthenticated(false)
      setError(null)
      prevPubkeyRef.current = currentPubkey
      return
    }

    prevPubkeyRef.current = currentPubkey

    // Try to restore session from cookie
    const token = getCookie()
    if (token && isJwtValid(token)) {
      const tokenPubkey = getJwtPubkey(token)
      if (tokenPubkey === currentPubkey) {
        // Cookie is valid and belongs to this wallet — restore session
        setAuthenticated(true)
        return
      } else {
        // Cookie belongs to a different wallet (e.g. leftover from a prior switch)
        clearToken()
      }
    }

    // No valid cookie — user must sign
    setAuthenticated(false)
  }, [connected, publicKey])

  // ── Sign challenge ──────────────────────────────────────────────────────────
  const authenticate = useCallback(async () => {
    if (!publicKey || !signMessage) return
    setAuthenticating(true)
    setError(null)
    try {
      const { nonce } = await getChallenge(publicKey.toBase58())
      const messageBytes = new TextEncoder().encode(nonce)
      const signature = await signMessage(messageBytes)
      const signatureB58 = bs58.encode(signature)
      const { access_token } = await login({
        public_key: publicKey.toBase58(),
        signature: signatureB58,
        message: nonce,
      })
      setToken(access_token) // writes cookie with JWT's own expiry
      setAuthenticated(true)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Authentication failed"
      setError(msg)
    } finally {
      setAuthenticating(false)
    }
  }, [publicKey, signMessage])

  // ── Logout ──────────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    clearToken()
    setAuthenticated(false)
    prevPubkeyRef.current = null
    disconnect()
  }, [disconnect])

  return (
    <AuthContext.Provider
      value={{ authenticated, authenticating, error, authenticate, logout }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
