import { getCaptchaToken } from './turnstile'
import { getSupabaseBrowserClient } from './supabase/client'

let pendingSignIn: Promise<string> | null = null

// Returns the current Supabase access token, starting an anonymous session the first time
// someone opens the app so they can try it without creating an account. A Turnstile token
// proves it's a person (Supabase rejects the sign-in without one when the captcha is on).
async function getAccessToken(): Promise<string> {
  const supabase = getSupabaseBrowserClient()
  const { data } = await supabase.auth.getSession()
  if (data.session) {
    return data.session.access_token
  }

  if (!pendingSignIn) {
    pendingSignIn = getCaptchaToken()
      .then((captchaToken) => supabase.auth.signInAnonymously(captchaToken ? { options: { captchaToken } } : undefined))
      .then(({ data: signInData, error }) => {
        if (error || !signInData.session) {
          throw error ?? new Error('Could not start a session')
        }
        return signInData.session.access_token
      })
      .finally(() => {
        pendingSignIn = null
      })
  }
  return pendingSignIn
}

// fetch() for Crosstalk's API routes: sends the user's session token.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken()
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return fetch(path, { ...init, headers })
}
