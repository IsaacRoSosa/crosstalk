// Connecting Apple Music in the browser with MusicKit JS: the person signs in with Apple, we list
// their library playlists and turn the one they pick into lines the import already understands
// (catalog song links, or title/artist rows for songs Apple has no catalog entry for). The Music
// User Token stays in the browser; the server only ever receives those lines.

const SCRIPT_URL = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js'

interface MusicKitApiResponse<T> {
  data: { data: T[]; next?: string }
}

export interface MusicKitInstance {
  isAuthorized: boolean
  storefrontId?: string
  authorize: () => Promise<string>
  unauthorize: () => Promise<void>
  api: { music: <T>(path: string, query?: Record<string, unknown>) => Promise<MusicKitApiResponse<T>> }
}

interface MusicKitGlobal {
  configure: (options: { developerToken: string; app: { name: string; build: string } }) => Promise<MusicKitInstance>
  getInstance: () => MusicKitInstance
}

declare global {
  interface Window {
    MusicKit?: MusicKitGlobal
  }
}

export class AppleMusicUnavailable extends Error {}

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

export interface LibraryPlaylist {
  id: string
  name: string
  artworkUrl: string | null
}

interface LibraryPlaylistResource {
  id: string
  attributes?: { name?: string; artwork?: { url?: string } }
}

interface LibrarySongResource {
  id: string
  type: string
  attributes?: {
    name?: string
    artistName?: string
    albumName?: string
    durationInMillis?: number
    playParams?: { catalogId?: string }
  }
  relationships?: { catalog?: { data?: Array<{ id: string }> } }
}

async function pages<T>(music: MusicKitInstance, path: string, query: Record<string, unknown>, max: number): Promise<T[]> {
  const items: T[] = []
  let next: string | undefined = path
  let first = true
  while (next && items.length < max) {
    const response: MusicKitApiResponse<T> = await music.api.music<T>(next, first ? query : undefined)
    items.push(...response.data.data)
    next = response.data.next
    first = false
  }
  return items.slice(0, max)
}

// Apple's "Replay", "Heavy Rotation" and the like first: they're what someone actually plays
const SUGGESTED = /replay|heavy rotation|on repeat|top 25|favorite|favourite|favoritas|más escuchad/i

export async function listLibraryPlaylists(music: MusicKitInstance): Promise<LibraryPlaylist[]> {
  const resources = await pages<LibraryPlaylistResource>(music, '/v1/me/library/playlists', { limit: 100 }, 500)
  const playlists = resources
    .filter((p) => p.attributes?.name)
    .map((p) => ({
      id: p.id,
      name: p.attributes?.name as string,
      artworkUrl: p.attributes?.artwork?.url?.replace('{w}', '80').replace('{h}', '80') ?? null,
    }))
  return [...playlists.filter((p) => SUGGESTED.test(p.name)), ...playlists.filter((p) => !SUGGESTED.test(p.name))]
}

export function isSuggestedPlaylist(name: string): boolean {
  return SUGGESTED.test(name)
}

function formatTime(ms: number | undefined): string {
  if (!ms || ms <= 0) return ''
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

// The playlist's songs, in order, as import input: one line per song
export async function playlistImportInput(music: MusicKitInstance, playlistId: string, max = 100): Promise<{ input: string; count: number }> {
  const songs = await pages<LibrarySongResource>(
    music,
    `/v1/me/library/playlists/${encodeURIComponent(playlistId)}/tracks`,
    { limit: 100, include: 'catalog' },
    max,
  )
  const storefront = music.storefrontId || 'us'
  const lines: string[] = []
  for (const song of songs) {
    if (song.type !== 'library-songs') continue
    const catalogId = song.relationships?.catalog?.data?.[0]?.id ?? song.attributes?.playParams?.catalogId
    const a = song.attributes
    if (catalogId) {
      lines.push(`https://music.apple.com/${storefront}/song/${catalogId}`)
    } else if (a?.name && a.artistName) {
      // Not in Apple's catalog (e.g. uploaded): found by name, like a row copied from the Mac app
      lines.push([a.name, '', formatTime(a.durationInMillis), a.artistName, a.albumName ?? ''].map((c) => c.replace(/\t/g, ' ')).join('\t'))
    }
  }
  return { input: lines.join('\n'), count: lines.length }
}
