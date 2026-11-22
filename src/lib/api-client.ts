import { getSupabaseBrowserClient } from './supabase/client'

let pendingSignIn: Promise<string> | null = null

// Returns the current Supabase access token, starting an anonymous session the first time
// someone opens the app so they can try it without creating an account.
async function getAccessToken(): Promise<string> {
  const supabase = getSupabaseBrowserClient()
  const { data } = await supabase.auth.getSession()
  if (data.session) {
    return data.session.access_token
  }

  if (!pendingSignIn) {
    pendingSignIn = supabase.auth
      .signInAnonymously()
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
