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

// Every step shows up in the browser console as [apple-music] ..., to see where a connection stops
function trace(message: string, details?: Record<string, unknown>) {
  if (details) console.info(`[apple-music] ${message}`, details)
  else console.info(`[apple-music] ${message}`)
}

// Rejects instead of waiting forever when Apple's script or sign-in never answers
function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      trace(`${what} timed out`, { ms })
      reject(new Error(`Apple Music didn't answer (${what}). Reload the page and try again.`))
    }, ms)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export class AppleMusicUnavailable extends Error {}
// Apple refused the saved or sent token: the person has to connect again
export class AppleMusicReconnect extends Error {}

let ready: Promise<MusicKitInstance> | null = null

// MusicKit announces itself with a "musickitloaded" event; the global is also polled in case the
// event fired before we listened (e.g. the script was already on the page)
function loadScript(): Promise<MusicKitGlobal> {
  if (typeof window.MusicKit?.configure === 'function') {
    trace('MusicKit already on the page')
    return Promise.resolve(window.MusicKit)
  }
  // MusicKit checks `process.versions.node` to tell Node from a browser. The dev server leaves a
  // `window.process` with only `env`, which made MusicKit crash ("reading 'node'") before defining
  // MusicKit.configure. An empty `versions` makes that check say "browser".
  const proc = (window as { process?: { versions?: unknown } }).process
  if (proc && typeof proc === 'object' && !proc.versions) {
    proc.versions = {}
    trace('added process.versions so MusicKit knows it runs in a browser')
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (how: string) => {
      if (settled || typeof window.MusicKit?.configure !== 'function') return
      settled = true
      window.clearInterval(poll)
      trace('MusicKit loaded', { how })
      resolve(window.MusicKit)
    }
    const poll = window.setInterval(() => finish('global'), 200)
    document.addEventListener('musickitloaded', () => finish('event'), { once: true })
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () => {
      trace('MusicKit script downloaded')
      // Downloaded but never set up (it threw while starting): say so instead of waiting
      window.setTimeout(() => {
        if (settled) return
        settled = true
        window.clearInterval(poll)
        trace('MusicKit downloaded but did not start', { hasGlobal: Boolean(window.MusicKit) })
        reject(new Error("Apple Music didn't start in this browser. Reload the page and try again."))
      }, 5000)
    }
    script.onerror = () => {
      settled = true
      window.clearInterval(poll)
      trace('MusicKit script failed to download (blocked by an ad blocker or the network?)')
      reject(new Error("Couldn't load Apple Music. Check your connection or ad blocker."))
    }
    trace('loading MusicKit script', { src: SCRIPT_URL })
    document.head.appendChild(script)
  })
}

// Loads and configures MusicKit once per page. Done ahead of the click, so authorize() runs right
// inside it and Safari doesn't block Apple's sign-in window as an unwanted popup.
export function prepareMusicKit(): Promise<MusicKitInstance> {
  if (!ready) {
    ready = (async () => {
      trace('requesting developer token')
      const response = await withTimeout(fetch('/api/apple-music/token'), 15_000, 'developer token')
      trace('developer token response', { status: response.status })
      if (response.status === 503) throw new AppleMusicUnavailable('Apple Music is not set up')
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || "Couldn't start Apple Music. Try again later.")
      }
      const { token } = (await response.json()) as { token: string }
      const MusicKit = await withTimeout(loadScript(), 20_000, 'loading MusicKit')
      trace('configuring MusicKit')
      const music = await withTimeout(
        MusicKit.configure({ developerToken: token, app: { name: 'Crosstalk', build: '1.0' } }),
        20_000,
        'configuring MusicKit',
      )
      trace('MusicKit ready', { isAuthorized: music.isAuthorized, storefront: music.storefrontId })
      return music
    })().catch((error) => {
      trace('MusicKit failed', { error: error instanceof Error ? error.message : String(error) })
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
  trace(`${init.method ?? 'GET'} ${path}`, { status: response.status, ...(response.ok ? {} : { error: data.error, code: data.code }) })
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
  if (!music.isAuthorized) {
    trace('asking Apple for permission')
    try {
      await music.authorize()
    } catch (error) {
      trace('Apple sign-in failed', { error: error instanceof Error ? error.message : String(error) })
      throw error
    }
    trace('Apple sign-in done', { hasUserToken: Boolean(music.musicUserToken), storefront: music.storefrontId })
  }
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
