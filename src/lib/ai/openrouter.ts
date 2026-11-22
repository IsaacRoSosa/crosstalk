// OpenRouter client. Crosstalk only ever calls free models, billed to nobody: each user connects
// their own OpenRouter account, and requests go through OpenRouter's Free Models Router.
// https://openrouter.ai/docs
import { HttpError } from '../http'
import { log } from '../log'

const OPENROUTER_API = 'https://openrouter.ai/api/v1'

// OpenRouter's router that picks an available free model (the free lineup changes often)
export const FREE_MODEL = 'openrouter/free'

// Free models allow 20 requests per minute; keep each user comfortably under that
const MIN_INTERVAL_MS = 3500
// Free models are sometimes slow; give up before a stuck request eats the serverless time limit
const REQUEST_TIMEOUT_MS = 50_000
const lastCallByUser = new Map<string, number>()

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export function isFreeModel(model: string): boolean {
  return model === FREE_MODEL || model.endsWith(':free')
}

function attributionHeaders(): Record<string, string> {
  return {
    'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
    'X-Title': 'Crosstalk',
  }
}

// Exchanges the one-time code from OpenRouter's PKCE flow for the user's API key
export async function exchangeOpenRouterCode(code: string, codeVerifier: string): Promise<string> {
  const response = await fetch(`${OPENROUTER_API}/auth/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: codeVerifier, code_challenge_method: 'S256' }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || typeof body.key !== 'string') {
    log.warn('openrouter', 'code exchange failed', { status: response.status, error: body?.error?.message ?? body?.error })
    throw new HttpError(400, 'Could not connect OpenRouter. The link may have expired; please try again.')
  }
  return body.key
}

async function waitForTurn(userId: string): Promise<void> {
  const last = lastCallByUser.get(userId) ?? 0
  const wait = last + MIN_INTERVAL_MS - Date.now()
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  lastCallByUser.set(userId, Date.now())
}

// Turns OpenRouter errors into messages a user can act on
function toHttpError(status: number, message: string): HttpError {
  const lower = message.toLowerCase()
  if (status === 401) {
    return new HttpError(401, 'Your OpenRouter connection is no longer valid. Connect it again.', { code: 'ai_not_connected' })
  }
  if (lower.includes('data policy') || lower.includes('no endpoints found')) {
    return new HttpError(
      403,
      'OpenRouter blocked the free models because of your privacy settings. Allow free endpoints in openrouter.ai/settings/privacy and try again.',
      { code: 'ai_data_policy' },
    )
  }
  if (status === 429) {
    return new HttpError(
      429,
      "You've reached OpenRouter's free usage limit for now (free models allow about 50 requests a day). Try again later.",
      { code: 'ai_rate_limited' },
    )
  }
  if (status === 402) {
    return new HttpError(402, 'OpenRouter rejected the request because of your account balance.', { code: 'ai_payment_required' })
  }
  return new HttpError(502, 'The AI service failed. Please try again.', { code: 'ai_failed' })
}

export async function chatCompletion(
  userId: string,
  apiKey: string,
  messages: ChatMessage[],
  options: { model?: string; temperature?: number } = {},
): Promise<{ text: string; model: string }> {
  const model = options.model ?? FREE_MODEL
  // Hard guarantee: never call a paid model
  if (!isFreeModel(model)) {
    throw new Error(`Refusing to call non-free model ${model}`)
  }

  await waitForTurn(userId)

  let response: Response
  try {
    response = await fetch(`${OPENROUTER_API}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...attributionHeaders(),
      },
      body: JSON.stringify({ model, messages, temperature: options.temperature ?? 0.7 }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    log.warn('openrouter', timedOut ? 'request timed out' : 'request threw', { model, error: String(error) })
    throw new HttpError(timedOut ? 504 : 502, timedOut ? 'The AI took too long to answer. Please try again.' : "Couldn't reach OpenRouter. Please try again.", {
      code: 'ai_failed',
    })
  }

  const body = await response.json().catch(() => ({}))
  const errorMessage: string = body?.error?.message ?? ''

  if (!response.ok || body?.error) {
    log.warn('openrouter', 'request failed', { status: response.status, model, error: errorMessage.slice(0, 300) })
    throw toHttpError(response.status, errorMessage)
  }

  const text: string | undefined = body?.choices?.[0]?.message?.content
  if (!text || !text.trim()) {
    log.warn('openrouter', 'empty response', { model: body?.model })
    throw new HttpError(502, 'The AI returned an empty answer. Please try again.', { code: 'ai_failed' })
  }

  return { text, model: typeof body.model === 'string' ? body.model : model }
}
