import { getCookie, setCookie, removeCookie } from "@/lib/cookies"

const BASE_URL = "https://api-tidal.akbaridria.com"

function getToken(): string | null {
  return getCookie()
}

export function setToken(token: string) {
  setCookie(token)
}

export function clearToken() {
  removeCookie()
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  }
  if (token) headers["Authorization"] = `Bearer ${token}`

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? "Request failed")
  }
  return res.json()
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function getChallenge(publicKey: string): Promise<{ nonce: string }> {
  return request(`/auth/challenge?public_key=${encodeURIComponent(publicKey)}`)
}

export async function login(body: {
  public_key: string
  signature: string
  message: string
}): Promise<{ access_token: string; token_type: string; user_id: string }> {
  return request("/auth/login", { method: "POST", body: JSON.stringify(body) })
}

// ── Wallet / Balances ─────────────────────────────────────────────────────────

export async function getWalletBalances(): Promise<{
  user_id: string
  public_key: string
  bot_wallet_balance: { sol: number; sol_lamports: number; usdc: number }
  user_wallet_balance: { sol: number; sol_lamports: number; usdc: number }
  pacifica_balance: {
    available_margin_collateral: number | null
    account_equity: number | null
    balance: number | null
  }
}> {
  return request("/wallet/balances")
}

export async function generateWallet(): Promise<{ public_key: string }> {
  return request("/generate-wallet", { method: "POST", body: JSON.stringify({}) })
}

export async function depositToPacifica(amount: number): Promise<{ transaction_hash: string }> {
  return request("/wallet/deposit-to-pacifica", {
    method: "POST",
    body: JSON.stringify({ amount }),
  })
}

export async function withdrawFromPacifica(amount: number): Promise<{ message: string; transaction_hash: string | null }> {
  return request("/wallet/withdraw-from-pacifica", {
    method: "POST",
    body: JSON.stringify({ amount }),
  })
}

// ── Strategies / Presets ──────────────────────────────────────────────────────

export interface StrategyPreset {
  id: string
  name: string
  description: string
  config: Record<string, unknown>
  tags?: string[]
}

export async function getStrategyPresets(): Promise<StrategyPreset[]> {
  return request("/strategies/presets")
}

export interface BotConfig {
  stop_loss_pct: number
  take_profit_pct: number
  max_slippage_pct: number
  size_usd: number
  leverage: number
  margin_mode: string
}

export async function createStrategyFromPreset(body: {
  trading_pair: string
  preset_id: string
  interval: string
  bot_config: BotConfig
}): Promise<{ id: string; message: string }> {
  return request("/strategies/from-preset", { method: "POST", body: JSON.stringify(body) })
}

export async function runBacktest(body: {
  symbol: string
  timeframe: string
  strategy_config: any
}): Promise<{
  "Total Return [%]": number
  "Win Rate [%]": number
  "Max Drawdown [%]": number
  "Total Trades": number
}> {
  return request("/backtest", { method: "POST", body: JSON.stringify(body) })
}

export async function startBot(strategy_id: string, allocate_margin: boolean = true): Promise<Record<string, unknown>> {
  return request("/start-bot", { method: "POST", body: JSON.stringify({ strategy_id, allocate_margin }) })
}

export async function withdrawSubaccountFunds(strategyId: string): Promise<{ ok: boolean; amount_withdrawn: string; message: string }> {
  return request(`/strategies/${strategyId}/withdraw`, { method: "POST" })
}

export async function depositSubaccountFunds(strategyId: string, amount: number): Promise<{ ok: boolean; amount_deposited: string; message: string }> {
  return request(`/strategies/${strategyId}/deposit`, { method: "POST", body: JSON.stringify({ amount }) })
}

export async function stopBot(strategyId: string): Promise<Record<string, unknown>> {
  return request("/stop-bot", { method: "POST", body: JSON.stringify({ strategy_id: strategyId }) })
}

export async function createStrategy(data: {
  trading_pair: string
  side: "buy" | "sell"
  name?: string
  config: Record<string, any>
  bot_config: BotConfig
}): Promise<{ id: string; message: string }> {
  return request("/strategies", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

// ── Active Strategies ──────────────────────────────────────────────────────────

export interface Strategy {
  id: string
  name: string
  trading_pair: string
  config?: Record<string, unknown>
  bot_config?: BotConfig
  created_at: string | null
  is_active?: boolean
  allocated_margin?: number
  pending_margin?: number
}

export async function getStrategies(): Promise<Strategy[]> {
  return request("/strategies")
}

export async function getStrategy(id: string): Promise<Strategy> {
  return request(`/strategies/${id}`)
}

// ── Logs ──────────────────────────────────────────────────────────────────────

export interface BotLog {
  id: string
  level: string
  message: string
  details: Record<string, unknown> | null
  created_at: string
  strategy_id: string | null
}

export async function getBotLogs(strategy_id?: string): Promise<BotLog[]> {
  const qs = strategy_id ? `?strategy_id=${strategy_id}` : ""
  return request(`/logs${qs}`)
}



export async function withdrawToUser(amount: number, destination_address: string): Promise<any> {
  return request("/wallet/withdraw-to-user", {
    method: "POST",
    body: JSON.stringify({ amount, destination_address }),
  })
}

export async function getAccountSettings(): Promise<any> {
  return request("/account/settings")
}

export async function updateLeverage(symbol: string, leverage: number, isolated?: boolean): Promise<any> {
  return request("/account/leverage", {
    method: "POST",
    body: JSON.stringify({ symbol, leverage, isolated }),
  })
}

