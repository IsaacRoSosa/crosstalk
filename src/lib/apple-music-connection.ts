// Apple Music connections (server only). A Google account's Music User Token is stored encrypted,
// so its playlists can be read from any device; a guest's token isn't stored and comes with each
// request instead (header X-Music-User-Token). Only the admin client touches the table.
import { decryptSecret, encryptSecret } from './crypto'
import { HttpError } from './http'
import { getAdminClient } from './supabase/server'
import { AppleMusicTokenRejected, fetchUserStorefront } from './apple-music'
import type { UserContext } from './session'

export interface AppleMusicConnectionStatus {
  // Saved to the account, so other devices don't need to connect again
  saved: boolean
}

export async function getAppleMusicConnectionStatus(userId: string): Promise<AppleMusicConnectionStatus> {
  const { data, error } = await getAdminClient()
    .from('apple_music_connections')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return { saved: Boolean(data) }
}

export async function saveAppleMusicToken(userId: string, userToken: string, storefront: string | null): Promise<void> {
  const { error } = await getAdminClient()
    .from('apple_music_connections')
    .upsert({ user_id: userId, encrypted_token: encryptSecret(userToken), storefront })
  if (error) throw error
}

export async function deleteAppleMusicConnection(userId: string): Promise<void> {
  const { error } = await getAdminClient().from('apple_music_connections').delete().eq('user_id', userId)
  if (error) throw error
}

export interface AppleMusicUser {
  userToken: string
  storefront: string
  // Whether the token came from the account (and should be forgotten if Apple refuses it)
  saved: boolean
}

// The token to read the person's library with: the saved one for Google accounts, otherwise the one
// the browser sent. Errors with code apple_music_not_connected when there's neither.
export async function requireAppleMusicUser(ctx: UserContext, request: Request): Promise<AppleMusicUser> {
  const sentToken = request.headers.get('X-Music-User-Token')?.trim()
  const sentStorefront = request.headers.get('X-Music-Storefront')?.trim() || null

  if (!ctx.isAnonymous) {
    const { data, error } = await getAdminClient()
      .from('apple_music_connections')
      .select('encrypted_token, storefront')
      .eq('user_id', ctx.userId)
      .maybeSingle()
    if (error) throw error
    if (data) {
      return { userToken: decryptSecret(data.encrypted_token), storefront: data.storefront ?? sentStorefront ?? 'us', saved: true }
    }
  }
  if (sentToken) {
    return { userToken: sentToken, storefront: sentStorefront ?? (await fetchUserStorefront(sentToken)), saved: false }
  }
  throw new HttpError(428, 'Connect Apple Music first.', { code: 'apple_music_not_connected' })
}

// Runs a library request; if Apple refuses the token, forgets a saved one and asks to reconnect
export async function withAppleMusicUser<T>(ctx: UserContext, request: Request, run: (user: AppleMusicUser) => Promise<T>): Promise<T> {
  const user = await requireAppleMusicUser(ctx, request)
  try {
    return await run(user)
  } catch (error) {
    if (error instanceof AppleMusicTokenRejected) {
      if (user.saved) await deleteAppleMusicConnection(ctx.userId)
      throw new HttpError(401, 'Apple Music needs you to connect again.', { code: 'apple_music_reconnect' })
    }
    throw error
  }
}
