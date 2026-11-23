// Connecting Apple Music in the browser. MusicKit JS is only used to sign in with Apple and get the
// Music User Token; reading playlists goes through our server, which keeps a Google account's
// token (encrypted) so other devices don't have to connect again. A guest's token stays in this
// browser and is sent along with each request instead.
import { apiFetch } from './api-client'
import { getSupabaseBrowserClient } from './supabase/client'
import type { LibraryPlaylist } from './apple-music-library'

export type { LibraryPlaylist } from './apple-music-library'
export { isSuggestedPlaylist } from './apple-music-library'

const SCRIPT_URL = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js'

export interface MusicKitInstance {
  isAuthorized: boolean
  musicUserToken?: string
  storefrontId?: string
  authorize: () => Promise<string>
  unauthorize: () => Promise<void>
}

interface MusicKitGlobal {
  configure: (options: { developerToken: string; app: { name: string; build: string } }) => Promise<MusicKitInstance>
}

declare global {
  interface Window {
    MusicKit?: MusicKitGlobal
  }
}

export class AppleMusicUnavailable extends Error {}
// Apple refused the saved or sent token: the person has to connect again
export class AppleMusicReconnect extends Error {}

let ready: Promise<MusicKitInstance> | null = null

function loadScript(): Promise<MusicKitGlobal> {
  if (window.MusicKit) return Promise.resolve(window.MusicKit)
  return new Promise((resolve, reject) => {
    const done = () => (window.MusicKit ? resolve(window.MusicKit) : reject(new Error('MusicKit did not load')))
    document.addEventListener('musickitloaded', done, { once: true })
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.onerror = () => reject(new Error("Couldn't load Apple Music. Check your connection or ad blocker."))
    document.head.appendChild(script)
  })
}

// Loads and configures MusicKit once per page. Done ahead of the click, so authorize() runs right
// inside it and Safari doesn't block Apple's sign-in window as an unwanted popup.
export function prepareMusicKit(): Promise<MusicKitInstance> {
  if (!ready) {
    ready = (async () => {
      const response = await fetch('/api/apple-music/token')
      if (response.status === 503) throw new AppleMusicUnavailable('Apple Music is not set up')
      if (!response.ok) throw new Error("Couldn't start Apple Music. Try again later.")
      const { token } = (await response.json()) as { token: string }
      const MusicKit = await loadScript()
      return MusicKit.configure({ developerToken: token, app: { name: 'Crosstalk', build: '1.0' } })
    })().catch((error) => {
      ready = null
      throw error
    })
  }
  return ready
}

async function call<T>(path: string, init: RequestInit = {}, music?: MusicKitInstance | null): Promise<T> {
  const headers = new Headers(init.headers)
  if (music?.isAuthorized && music.musicUserToken) {
    headers.set('X-Music-User-Token', music.musicUserToken)
    if (music.storefrontId) headers.set('X-Music-Storefront', music.storefrontId)
  }
  const response = await apiFetch(path, { ...init, headers })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (data.code === 'apple_music_reconnect' || data.code === 'apple_music_not_connected') {
      await music?.unauthorize().catch(() => {})
      throw new AppleMusicReconnect(data.error || 'Connect Apple Music again.')
    }
    throw new Error(data.error || 'Something went wrong with Apple Music. Try again.')
  }
  return data as T
}

// Whether this account has Apple Music saved. Doesn't start a guest session just to ask.
export async function isAppleMusicSaved(): Promise<boolean> {
  const { data } = await getSupabaseBrowserClient().auth.getSession()
  if (!data.session || data.session.user.is_anonymous) return false
  const status = await call<{ saved: boolean }>('/api/apple-music/connection').catch(() => ({ saved: false }))
  return status.saved
}

// Signs in with Apple (if needed) and saves the token to a Google account. Call from a click.
export async function connectAppleMusic(music: MusicKitInstance): Promise<{ saved: boolean }> {
  if (!music.isAuthorized) await music.authorize()
  if (!music.musicUserToken) throw new Error('Apple Music did not return a sign-in. Try again.')
  return call<{ saved: boolean }>('/api/apple-music/connection', {
    method: 'POST',
    body: JSON.stringify({ userToken: music.musicUserToken, storefront: music.storefrontId ?? null }),
  })
}

export async function disconnectAppleMusic(music: MusicKitInstance | null): Promise<void> {
  await music?.unauthorize().catch(() => {})
  const { data } = await getSupabaseBrowserClient().auth.getSession()
  if (data.session && !data.session.user.is_anonymous) await call('/api/apple-music/connection', { method: 'DELETE' })
}

export async function listLibraryPlaylists(music: MusicKitInstance | null): Promise<LibraryPlaylist[]> {
  return (await call<{ playlists: LibraryPlaylist[] }>('/api/apple-music/playlists', {}, music)).playlists
}

// The playlist's songs, in order, as import input: one line per song
export function playlistImportInput(music: MusicKitInstance | null, playlistId: string): Promise<{ input: string; count: number }> {
  return call(`/api/apple-music/playlists/${encodeURIComponent(playlistId)}`, {}, music)
}
