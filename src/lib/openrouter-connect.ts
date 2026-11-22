// Browser side of "Connect OpenRouter" (OAuth PKCE): https://openrouter.ai/docs/use-cases/oauth-pkce
// 1. startOpenRouterConnect() creates a one-time secret (code verifier), keeps it in sessionStorage
//    and sends the user to OpenRouter with its SHA-256 hash (code challenge).
// 2. OpenRouter sends them back to /ai/callback with a one-time code.
// 3. completeOpenRouterConnect() sends code + verifier to our server, which exchanges them for
//    the user's key and stores it encrypted. The key itself never reaches this code.
import { apiFetch } from './api-client'

const VERIFIER_KEY = 'crosstalk.openrouter.verifier'
const STATE_KEY = 'crosstalk.openrouter.state'
// Smallest spend limit OpenRouter accepts (0 is treated as "no limit"). Crosstalk only calls
// free models, so this only matters if a stored key were ever stolen.
const SPEND_LIMIT_USD = '0.01'

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomString(byteLength: number): string {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)))
}

async function sha256Base64url(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return base64url(new Uint8Array(digest))
}

export async function startOpenRouterConnect(): Promise<void> {
  const verifier = randomString(32)
  const state = randomString(16)
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  sessionStorage.setItem(STATE_KEY, state)

  const params = new URLSearchParams({
    callback_url: `${window.location.origin}/ai/callback`,
    code_challenge: await sha256Base64url(verifier),
    code_challenge_method: 'S256',
    key_label: 'Crosstalk',
    limit: SPEND_LIMIT_USD,
    state,
  })
  window.location.assign(`https://openrouter.ai/auth?${params}`)
}

export async function completeOpenRouterConnect(code: string, state: string | null): Promise<void> {
  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  const expectedState = sessionStorage.getItem(STATE_KEY)
  sessionStorage.removeItem(VERIFIER_KEY)
  sessionStorage.removeItem(STATE_KEY)

  if (!verifier) {
    throw new Error('This connection link has already been used or expired. Please connect again.')
  }
  // `state` protects against someone tricking the browser into finishing a connection it didn't start
  if (expectedState && state !== expectedState) {
    throw new Error("This connection didn't start here. Please connect again.")
  }

  const response = await apiFetch('/api/ai/openrouter/exchange', {
    method: 'POST',
    body: JSON.stringify({ code, codeVerifier: verifier }),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || 'Could not connect OpenRouter. Please try again.')
  }
}
