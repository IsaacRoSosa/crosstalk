// Deezer's public API: catalog, tracks and public playlists, no key required.
// https://developers.deezer.com/api

const DEEZER_API = 'https://api.deezer.com'
const SHORT_LINK_HOSTS = new Set(['link.deezer.com', 'deezer.page.link'])

export interface DeezerTrack {
  id: number
  title: string
  isrc?: string
  duration: number // seconds
  artist: { name: string }
  album: { title: string; cover_xl?: string; cover_big?: string }
}

async function deezerGet<T>(path: string): Promise<T> {
  const response = await fetch(`${DEEZER_API}${path}`)
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
    const response = await fetch(parsed, { redirect: 'follow' })
    return response.url || null
  } catch {
    return null
  }
}
