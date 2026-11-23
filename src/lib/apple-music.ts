// Apple Music's catalog API (server only): songs and public playlists from pasted links, with their
// ISRC so they meet the same catalog rows as Spotify and Deezer songs. Reading someone's own library
// would also need a Music User Token from MusicKit JS; this file only uses the developer token.
// https://developer.apple.com/documentation/applemusicapi
import { createPrivateKey, sign } from 'node:crypto'
import { pickSong, type SongQuery } from './song-match'
import {
  songsToImportLines,
  toLibraryPlaylists,
  type LibraryPlaylist,
  type LibraryPlaylistResource,
  type LibrarySongResource,
} from './apple-music-library'

const API = 'https://api.music.apple.com/v1'
// Apple allows up to ~6 months; a short-lived token cached per server instance is plenty
const TOKEN_LIFETIME_S = 12 * 60 * 60
const DEFAULT_STOREFRONT = 'us'

export interface AppleMusicSong {
  id: string
  title: string
  artist: string
  album: string | null
  isrc: string | null
  durationMs: number | null
  coverUrl: string | null
}

interface SongResource {
  id: string
  type: string
  attributes?: {
    name?: string
    artistName?: string
    albumName?: string
    isrc?: string
    durationInMillis?: number
    artwork?: { url?: string }
  }
}

export function isAppleMusicConfigured(): boolean {
  return Boolean(process.env.APPLE_MUSIC_TEAM_ID && process.env.APPLE_MUSIC_KEY_ID && process.env.APPLE_MUSIC_PRIVATE_KEY)
}

let cachedToken: { value: string; expiresAt: number } | null = null

// The .p8 contents. Env vars often carry it on one line with literal \n, so restore the line breaks.
function privateKeyPem(): string {
  return (process.env.APPLE_MUSIC_PRIVATE_KEY ?? '').replace(/\\n/g, '\n').trim()
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url')
}

// ES256 JWT signed with the MusicKit key: header { alg, kid }, payload { iss: team id, iat, exp }
export function createDeveloperToken(now = Math.floor(Date.now() / 1000)): string {
  const teamId = process.env.APPLE_MUSIC_TEAM_ID
  const keyId = process.env.APPLE_MUSIC_KEY_ID
  if (!teamId || !keyId || !process.env.APPLE_MUSIC_PRIVATE_KEY) {
    throw new Error('Apple Music is not configured (APPLE_MUSIC_TEAM_ID, APPLE_MUSIC_KEY_ID, APPLE_MUSIC_PRIVATE_KEY)')
  }
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId }))
  const payload = base64url(JSON.stringify({ iss: teamId, iat: now, exp: now + TOKEN_LIFETIME_S }))
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: createPrivateKey(privateKeyPem()),
    // JWS wants the raw r||s signature, not DER
    dsaEncoding: 'ieee-p1363',
  })
  return `${header}.${payload}.${base64url(signature)}`
}

function developerToken(): string {
  const now = Date.now()
  if (!cachedToken || now > cachedToken.expiresAt) {
    cachedToken = { value: createDeveloperToken(), expiresAt: now + (TOKEN_LIFETIME_S - 600) * 1000 }
  }
  return cachedToken.value
}

class AppleMusicNotFound extends Error {}

async function appleGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${developerToken()}` },
    signal: AbortSignal.timeout(12_000),
  })
  if (response.status === 404) throw new AppleMusicNotFound(path)
  if (!response.ok) throw new Error(`Apple Music request failed: ${response.status}`)
  return (await response.json()) as T
}

function storefrontOf(value: string | null | undefined): string {
  return value && /^[a-z]{2}$/.test(value) ? value : DEFAULT_STOREFRONT
}

// Artwork urls are templates: .../{w}x{h}bb.jpg
function coverUrl(template: string | undefined): string | null {
  return template ? template.replace('{w}', '600').replace('{h}', '600') : null
}

export function toAppleMusicSong(resource: SongResource): AppleMusicSong | null {
  const a = resource.attributes
  if (resource.type !== 'songs' || !a?.name) return null
  return {
    id: resource.id,
    title: a.name,
    artist: a.artistName || 'Unknown artist',
    album: a.albumName ?? null,
    isrc: a.isrc ?? null,
    durationMs: a.durationInMillis && a.durationInMillis > 0 ? a.durationInMillis : null,
    coverUrl: coverUrl(a.artwork?.url),
  }
}

// A song in the storefront from its link, or in the US one when it isn't sold there
export async function fetchAppleMusicSong(id: string, storefront?: string | null): Promise<AppleMusicSong> {
  const stores = [...new Set([storefrontOf(storefront), DEFAULT_STOREFRONT])]
  for (const store of stores) {
    try {
      const body = await appleGet<{ data: SongResource[] }>(`/catalog/${store}/songs/${encodeURIComponent(id)}`)
      const song = body.data[0] ? toAppleMusicSong(body.data[0]) : null
      if (song) return song
    } catch (error) {
      if (!(error instanceof AppleMusicNotFound)) throw error
    }
  }
  throw new Error(`Apple Music song ${id} not found`)
}

// The songs of a public playlist (Apple's own, or one a user shared), skipping music videos
export async function fetchAppleMusicPlaylistSongs(id: string, storefront?: string | null, maxSongs = 100): Promise<AppleMusicSong[]> {
  const songs: AppleMusicSong[] = []
  let next: string | undefined = `/catalog/${storefrontOf(storefront)}/playlists/${encodeURIComponent(id)}/tracks?limit=100`
  while (next && songs.length < maxSongs) {
    const page: { data: SongResource[]; next?: string } = await appleGet(next)
    for (const resource of page.data) {
      const song = toAppleMusicSong(resource)
      if (song) songs.push(song)
    }
    // `next` comes back as a path starting with /v1
    next = page.next?.replace(/^\/v1/, '')
  }
  return songs.slice(0, maxSongs)
}

// Finds a song by title and artist (rows pasted from the Apple Music app carry no id).
// Null when the catalog has nothing that really matches.
export async function searchAppleMusicSong(query: SongQuery, storefront?: string | null): Promise<AppleMusicSong | null> {
  const term = encodeURIComponent(`${query.title} ${query.artist}`.slice(0, 200))
  const body = await appleGet<{ results?: { songs?: { data?: SongResource[] } } }>(
    `/catalog/${storefrontOf(storefront)}/search?types=songs&limit=10&term=${term}`,
  )
  const songs = (body.results?.songs?.data ?? []).map(toAppleMusicSong).filter((song): song is AppleMusicSong => song !== null)
  return pickSong(query, songs)
}

// ── Someone's own library (needs their Music User Token) ─────────────────────

// Apple refused the person's token (expired, or they removed Crosstalk's access): reconnect
export class AppleMusicTokenRejected extends Error {}

async function libraryGet<T>(path: string, userToken: string): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${developerToken()}`, 'Music-User-Token': userToken },
    signal: AbortSignal.timeout(12_000),
  })
  if (response.status === 401 || response.status === 403) throw new AppleMusicTokenRejected(`Apple Music refused the token (${response.status})`)
  if (!response.ok) throw new Error(`Apple Music library request failed: ${response.status}`)
  return (await response.json()) as T
}

async function libraryPages<T>(path: string, userToken: string, max: number): Promise<T[]> {
  const items: T[] = []
  let next: string | undefined = path
  while (next && items.length < max) {
    const page: { data: T[]; next?: string } = await libraryGet(next, userToken)
    items.push(...page.data)
    next = page.next?.replace(/^\/v1/, '')
  }
  return items.slice(0, max)
}

// The person's storefront (country), for the catalog links of their songs
export async function fetchUserStorefront(userToken: string): Promise<string> {
  const body = await libraryGet<{ data: Array<{ id: string }> }>('/me/storefront', userToken)
  return storefrontOf(body.data[0]?.id)
}

export async function fetchLibraryPlaylists(userToken: string): Promise<LibraryPlaylist[]> {
  return toLibraryPlaylists(await libraryPages<LibraryPlaylistResource>('/me/library/playlists?limit=100', userToken, 500))
}

export async function fetchLibraryPlaylistLines(userToken: string, playlistId: string, storefront: string, max = 100): Promise<string[]> {
  const songs = await libraryPages<LibrarySongResource>(
    `/me/library/playlists/${encodeURIComponent(playlistId)}/tracks?limit=100&include=catalog`,
    userToken,
    max,
  )
  return songsToImportLines(songs, storefrontOf(storefront))
}
