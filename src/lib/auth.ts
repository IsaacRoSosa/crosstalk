// Account actions in the browser. Everyone starts as an anonymous Supabase user (see api-client.ts);
// "Save with Google" links Google to that same user, so their nucleus, songs and AI connection stay.
import type { User } from '@supabase/supabase-js'
import { apiFetch } from './api-client'
import { getSupabaseBrowserClient } from './supabase/client'

// Set before signing in to an existing Google account from an anonymous session, so the callback
// can move the anonymous user's songs into that account
const MERGE_FROM_KEY = 'crosstalk.mergeFromAnonymous'

function callbackUrl(): string {
  return `${window.location.origin}/auth/callback`
}

export interface AccountInfo {
  isAnonymous: boolean
  email: string | null
  name: string | null
  avatarUrl: string | null
}

export function toAccountInfo(user: User | null | undefined): AccountInfo | null {
  if (!user) return null
  const meta = user.user_metadata ?? {}
  return {
    isAnonymous: user.is_anonymous ?? false,
    email: user.email ?? null,
    name: (meta.full_name as string | undefined) ?? (meta.name as string | undefined) ?? null,
    avatarUrl: (meta.avatar_url as string | undefined) ?? (meta.picture as string | undefined) ?? null,
  }
}

// From an anonymous session: attach Google to the current user (keeps everything).
// Otherwise: a normal Google sign-in.
export async function saveWithGoogle(): Promise<void> {
  const supabase = getSupabaseBrowserClient()
  const { data } = await supabase.auth.getSession()
  const options = { redirectTo: callbackUrl() }

  const { error } = data.session?.user.is_anonymous
    ? await supabase.auth.linkIdentity({ provider: 'google', options })
    : await supabase.auth.signInWithOAuth({ provider: 'google', options })
  if (error?.code === 'manual_linking_disabled') {
    throw new Error('Saving with Google is not enabled yet (Supabase: enable manual linking).')
  }
  if (error) throw error
}

// For when Google is already linked to another Crosstalk account: sign in to that account and
// bring this anonymous session's songs along
export async function signInToExistingGoogleAccount(): Promise<void> {
  const supabase = getSupabaseBrowserClient()
  const { data } = await supabase.auth.getSession()
  if (data.session?.user.is_anonymous) {
    sessionStorage.setItem(MERGE_FROM_KEY, data.session.access_token)
  }
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callbackUrl() } })
  if (error) throw error
}

// Called by the callback page once the Google session is active
export async function mergePendingAnonymousAccount(): Promise<number> {
  const anonymousAccessToken = sessionStorage.getItem(MERGE_FROM_KEY)
  sessionStorage.removeItem(MERGE_FROM_KEY)
  if (!anonymousAccessToken) return 0

  const response = await apiFetch('/api/account/merge', {
    method: 'POST',
    body: JSON.stringify({ anonymousAccessToken }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Could not bring your songs into this account')
  return data.mergedTracks ?? 0
}

// After signing out, the next request starts a fresh anonymous session
export async function signOut(): Promise<void> {
  await getSupabaseBrowserClient().auth.signOut()
  window.location.assign('/')
}
