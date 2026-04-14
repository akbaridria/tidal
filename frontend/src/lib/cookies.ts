const COOKIE_NAME = "tidal_jwt"

/** Write the JWT cookie, expiring at the same time as the token itself. */
export function setCookie(token: string): void {
  // Decode the JWT exp claim (without verifying — backend verifies)
  const expires = getJwtExpiry(token)
  const expiresStr = expires
    ? `; expires=${expires.toUTCString()}`
    : `; max-age=${60 * 60 * 24 * 7}` // fallback: 7 days in seconds

  document.cookie =
    `${COOKIE_NAME}=${encodeURIComponent(token)}` +
    expiresStr +
    `; path=/; SameSite=Strict`
}

/** Read the JWT cookie value, or null if absent / expired. */
export function getCookie(): string | null {
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${COOKIE_NAME}=`))

  if (!match) return null
  return decodeURIComponent(match.split("=")[1])
}

/** Delete the JWT cookie immediately. */
export function removeCookie(): void {
  document.cookie =
    `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Strict`
}

export function getJwtPubkey(token: string): string | null {
  const payload = decodeJwtPayload(token)
  return payload?.pubkey ? String(payload.pubkey) : null
}

/** Check whether the token's `exp` is in the future. */
export function isJwtValid(token: string): boolean {
  const payload = decodeJwtPayload(token)
  if (!payload?.exp) return false
  return payload.exp * 1000 > Date.now()
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function decodeJwtPayload(token: string): any | null {
  try {
    const base64 = token.split(".")[1]
    // Pad base64 if needed
    const padded = base64.replace(/-/g, "+").replace(/_/g, "/")
    const json = atob(padded)
    return JSON.parse(json)
  } catch {
    return null
  }
}

function getJwtExpiry(token: string): Date | null {
  const payload = decodeJwtPayload(token)
  if (!payload?.exp || typeof payload.exp !== "number") return null
  return new Date(payload.exp * 1000)
}
