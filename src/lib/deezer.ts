// Deezer's public API: catalog, tracks and public playlists, no key required.
// https://developers.deezer.com/api

import { pickSong, type SongQuery } from './song-match'

const DEEZER_API = 'https://api.deezer.com'
const SHORT_LINK_HOSTS = new Set(['link.deezer.com', 'deezer.page.link'])

export interface DeezerTrack {
  id: number
  title: string
  isrc?: string
  duration: number // seconds
  artist: { name: string }
  album: { id?: number; title: string; cover_xl?: string; cover_big?: string }
}

async function deezerGet<T>(path: string): Promise<T> {
  const response = await fetch(`${DEEZER_API}${path}`, { signal: AbortSignal.timeout(12_000) })
  if (!response.ok) {
    throw new Error(`Deezer request failed: ${response.status}`)
  }
  const body = await response.json()
  // Deezer answers 200 with { error: { type, message, code } } for missing or private resources
  if (body?.error) {
    throw new Error(`Deezer: ${body.error.message ?? body.error.type ?? 'unknown error'}`)
  }
  return body as T
}

export function fetchDeezerTrack(trackId: number): Promise<DeezerTrack> {
  return deezerGet<DeezerTrack>(`/track/${trackId}`)
}

// The genre Deezer files a song's album under (e.g. "Rap/Hip Hop", "Alternative"). Found by Deezer id,
// or by ISRC for songs that came from Spotify. Best effort: null when Deezer doesn't know it.
export async function findDeezerGenre(song: { deezerId?: number | null; isrc?: string | null }): Promise<string | null> {
  try {
    const track = song.deezerId
      ? await fetchDeezerTrack(song.deezerId)
      : song.isrc
        ? await deezerGet<DeezerTrack>(`/track/isrc:${encodeURIComponent(song.isrc)}`)
        : null
    if (!track?.album?.id) return null
    const album = await deezerGet<{ genres?: { data?: Array<{ name: string }> } }>(`/album/${track.album.id}`)
    return album.genres?.data?.[0]?.name ?? null
  } catch {
    return null
  }
}

export async function fetchDeezerPlaylistTracks(playlistId: number, maxTracks = 100): Promise<DeezerTrack[]> {
  const tracks: DeezerTrack[] = []
  let index = 0
  const pageSize = 50

  while (tracks.length < maxTracks) {
    const page = await deezerGet<{ data: DeezerTrack[]; next?: string }>(
      `/playlist/${playlistId}/tracks?limit=${pageSize}&index=${index}`,
    )
    tracks.push(...page.data)
    if (!page.next || page.data.length === 0) break
    index += pageSize
  }

  return tracks.slice(0, maxTracks)
}

// Share links like https://link.deezer.com/s/... redirect to the real deezer.com URL.
// Only Deezer's own short-link hosts are followed.
export async function resolveDeezerShortLink(url: string): Promise<string | null> {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !SHORT_LINK_HOSTS.has(parsed.hostname)) return null
    const response = await fetch(parsed, { redirect: 'follow', signal: AbortSignal.timeout(12_000) })
    return response.url || null
  } catch {
    return null
  }
}

// Finds a song by title and artist, for pasted rows when Apple Music isn't set up.
// Null when Deezer has nothing that really matches.
export async function searchDeezerTrack(query: SongQuery): Promise<DeezerTrack | null> {
  const quote = (value: string) => value.replace(/"/g, '')
  const q = encodeURIComponent(`artist:"${quote(query.artist)}" track:"${quote(query.title)}"`)
  const page = await deezerGet<{ data: DeezerTrack[] }>(`/search?limit=10&q=${q}`)
  const candidates = page.data.map((track) => ({
    track,
    title: track.title,
    artist: track.artist?.name ?? '',
    durationMs: track.duration > 0 ? track.duration * 1000 : null,
  }))
  return pickSong(query, candidates)?.track ?? null
}
