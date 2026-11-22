// Browser side of "Connect OpenRouter" (OAuth PKCE): https://openrouter.ai/docs/use-cases/oauth-pkce
// 1. startOpenRouterConnect() creates a one-time secret (code verifier) and opens OpenRouter in a
//    new tab with its SHA-256 hash (code challenge), so the page that started it stays open (people
//    who need to create an OpenRouter account can take a while, and may come back in another tab).
// 2. OpenRouter sends them to /ai/callback with a one-time code.
// 3. completeOpenRouterConnect() sends code + verifier to our server, which exchanges them for the
//    user's key and stores it encrypted (the key never reaches this code), then tells the original
//    tab, which continues on its own.
import { apiFetch } from './api-client'
import { getTemp, removeTemp, setTemp } from './temp-storage'

const VERIFIER_KEY = 'crosstalk.openrouter.verifier'
const STATE_KEY = 'crosstalk.openrouter.state'
const RETURN_TO_KEY = 'crosstalk.openrouter.returnTo'
// OpenRouter codes expire after 10 minutes; account sign-up can take longer than that, but then the
// person just clicks connect again
const FLOW_TTL_MS = 30 * 60 * 1000
// Smallest spend limit OpenRouter accepts (0 is treated as "no limit"). Crosstalk only calls
// free models, so this only matters if a stored key were ever stolen.
const SPEND_LIMIT_USD = '0.01'
const CHANNEL_NAME = 'crosstalk-ai'

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

function openChannel(): BroadcastChannel | null {
  try {
    return new BroadcastChannel(CHANNEL_NAME)
  } catch {
    return null
  }
}

// Call from a click handler. Returns how OpenRouter was opened: in a new tab (the current page
// stays and should wait with listenForAiConnected) or in this tab (when the browser blocked the new tab).
export async function startOpenRouterConnect(returnTo = '/app'): Promise<'new_tab' | 'same_tab'> {
  // Open the tab right away, while still inside the click, or popup blockers stop it
  const tab = window.open('', '_blank')

  const verifier = randomString(32)
  const state = randomString(16)
  setTemp(VERIFIER_KEY, verifier, FLOW_TTL_MS)
  setTemp(STATE_KEY, state, FLOW_TTL_MS)
  setTemp(RETURN_TO_KEY, returnTo, FLOW_TTL_MS)

  const params = new URLSearchParams({
    callback_url: `${window.location.origin}/ai/callback`,
    code_challenge: await sha256Base64url(verifier),
    code_challenge_method: 'S256',
    key_label: 'Crosstalk',
    limit: SPEND_LIMIT_USD,
    state,
  })
  const url = `https://openrouter.ai/auth?${params}`

  if (tab) {
    // The new tab must not be able to reach back into this page
    tab.opener = null
    tab.location.href = url
    return 'new_tab'
  }
  window.location.assign(url)
  return 'same_tab'
}

// Runs `onConnected` when another tab finishes connecting OpenRouter. Returns a cleanup function.
export function listenForAiConnected(onConnected: () => void): () => void {
  const channel = openChannel()
  if (!channel) return () => {}
  channel.onmessage = (event) => {
    if (event.data?.type === 'connected') {
      channel.postMessage({ type: 'ack' })
      onConnected()
    }
  }
  return () => channel.close()
}

// Tells a waiting Crosstalk tab that the AI is connected. Resolves true if one answered.
function announceConnected(): Promise<boolean> {
  const channel = openChannel()
  if (!channel) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      channel.close()
      resolve(false)
    }, 700)
    channel.onmessage = (event) => {
      if (event.data?.type === 'ack') {
        clearTimeout(timeout)
        channel.close()
        resolve(true)
      }
    }
    channel.postMessage({ type: 'connected' })
  })
}

// Returns where to go next: { handedOff: true } when the tab that started the flow took over
// (this tab can close), otherwise the path to continue in this tab.
export async function completeOpenRouterConnect(
  code: string,
  state: string | null,
): Promise<{ handedOff: boolean; returnTo: string }> {
  const verifier = getTemp(VERIFIER_KEY)
  const expectedState = getTemp(STATE_KEY)
  const returnTo = getTemp(RETURN_TO_KEY)
  removeTemp(VERIFIER_KEY)
  removeTemp(STATE_KEY)
  removeTemp(RETURN_TO_KEY)

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

  const handedOff = await announceConnected()
  // Only same-site paths, never a full URL
  const safeReturnTo = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/app'
  return { handedOff, returnTo: safeReturnTo }
}
