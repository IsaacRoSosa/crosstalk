// Cloudflare Turnstile, so bots can't mint anonymous Supabase sessions. Supabase checks the token
// (Authentication > Bot and Abuse Protection). The widget is "managed" with interaction-only
// appearance: most people never see it; when Cloudflare wants a click, a small overlay shows it.
// Without VITE_TURNSTILE_SITE_KEY (local dev) no token is requested.

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const TIMEOUT_MS = 60_000

interface TurnstileRenderOptions {
  sitekey: string
  action?: string
  appearance?: 'always' | 'execute' | 'interaction-only'
  theme?: 'light' | 'dark' | 'auto'
  callback?: (token: string) => void
  'error-callback'?: (code: string) => boolean | undefined
  'expired-callback'?: () => void
  'timeout-callback'?: () => void
  'before-interactive-callback'?: () => void
  'after-interactive-callback'?: () => void
  'unsupported-callback'?: () => void
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (!scriptPromise) {
    scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = SCRIPT_URL
      script.async = true
      script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not load')))
      script.onerror = () => reject(new Error('Could not load the bot check. Check your connection or ad blocker.'))
      document.head.appendChild(script)
    }).catch((error) => {
      scriptPromise = null
      throw error
    })
  }
  return scriptPromise
}

export function isCaptchaEnabled(): boolean {
  return Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY)
}

// Overlay that stays hidden unless Cloudflare asks for a click
function createOverlay(): { root: HTMLDivElement; slot: HTMLDivElement; show: () => void; hide: () => void } {
  const root = document.createElement('div')
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-modal', 'true')
  root.setAttribute('aria-label', 'Quick check')
  root.className = 'fixed inset-0 z-[1000] hidden items-center justify-center bg-black/80 p-6 font-mono text-white'

  const box = document.createElement('div')
  box.className = 'relative flex flex-col items-center gap-4 border border-white/25 bg-black p-6'

  const label = document.createElement('div')
  label.className = 'text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50'
  label.textContent = 'Quick check'

  const text = document.createElement('div')
  text.className = 'max-w-[300px] text-center text-xs text-white/80'
  text.textContent = 'Confirm you are human to start your session.'

  const slot = document.createElement('div')
  slot.className = 'min-h-[65px]'

  box.append(label, text, slot)
  root.append(box)
  document.body.appendChild(root)

  return {
    root,
    slot,
    show: () => {
      root.classList.remove('hidden')
      root.classList.add('flex')
    },
    hide: () => {
      root.classList.add('hidden')
      root.classList.remove('flex')
    },
  }
}

// Returns a single-use Turnstile token, or undefined when the captcha is not configured.
export async function getCaptchaToken(action = 'anonymous_sign_in'): Promise<string | undefined> {
  const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY
  if (!sitekey || typeof window === 'undefined') return undefined

  const turnstile = await loadTurnstile()
  const overlay = createOverlay()

  return new Promise<string>((resolve, reject) => {
    let widgetId: string | null = null
    let settled = false

    const finish = (result: { token: string } | { error: Error }) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      if (widgetId) {
        try {
          turnstile.remove(widgetId)
        } catch {
          // already gone
        }
      }
      overlay.root.remove()
      if ('token' in result) resolve(result.token)
      else reject(result.error)
    }

    const timer = window.setTimeout(
      () => finish({ error: new Error('The bot check took too long. Reload the page and try again.') }),
      TIMEOUT_MS,
    )

    widgetId = turnstile.render(overlay.slot, {
      sitekey,
      action,
      appearance: 'interaction-only',
      theme: 'dark',
      callback: (token) => finish({ token }),
      'before-interactive-callback': overlay.show,
      'after-interactive-callback': overlay.hide,
      'error-callback': (code) => {
        finish({ error: new Error(`The bot check failed (${code}). Reload the page and try again.`) })
        return true
      },
      'expired-callback': () => finish({ error: new Error('The bot check expired. Try again.') }),
      'timeout-callback': () => finish({ error: new Error('The bot check timed out. Try again.') }),
      'unsupported-callback': () => finish({ error: new Error('This browser is not supported by the bot check.') }),
    })
  })
}
