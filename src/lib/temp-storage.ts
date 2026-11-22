// Small values that must survive reloads and new tabs for a while (e.g. across the OpenRouter
// sign-in, which may come back in a different tab), stored in localStorage with an expiry.

interface Entry {
  value: string
  expiresAt: number
}

export function setTemp(key: string, value: string, ttlMs: number): void {
  try {
    localStorage.setItem(key, JSON.stringify({ value, expiresAt: Date.now() + ttlMs } satisfies Entry))
  } catch {
    // storage full or disabled: the flow falls back to asking again
  }
}

export function getTemp(key: string): string | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const entry = JSON.parse(raw) as Entry
    if (typeof entry.value !== 'string' || Date.now() > entry.expiresAt) {
      localStorage.removeItem(key)
      return null
    }
    return entry.value
  } catch {
    return null
  }
}

export function removeTemp(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}
