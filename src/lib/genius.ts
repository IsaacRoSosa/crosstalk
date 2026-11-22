// Genius is only used to link each song to its lyrics page ("View lyrics").
// Lyrics themselves come from LRCLIB: Genius blocks downloading its song pages (403 + Cloudflare).
import { log } from './log'

interface GeniusSearchResponse {
  response: {
    hits: Array<{
      type: string
      result: { url: string; title: string; primary_artist: { name: string } }
    }>
  }
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Best effort: returns null on any problem, since the link is optional.
export async function findGeniusSongUrl(title: string, artist: string, accessToken: string | undefined): Promise<string | null> {
  if (!accessToken) return null
  const query = `${title} ${artist}`

  try {
    const response = await fetch(`https://api.genius.com/search?q=${encodeURIComponent(query)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) {
      log.warn('genius', 'search request failed', { query, status: response.status })
      return null
    }
    const data = (await response.json()) as GeniusSearchResponse
    const songs = (data.response?.hits ?? []).filter((hit) => hit.type === 'song').map((hit) => hit.result)

    // Only link a result by the same artist; a wrong link is worse than none
    const wantedArtist = normalize(artist)
    const song = songs.find((s) => {
      const hitArtist = normalize(s.primary_artist.name)
      return hitArtist.includes(wantedArtist) || wantedArtist.includes(hitArtist)
    })
    return song?.url ?? null
  } catch (error) {
    log.warn('genius', 'search request threw', { query, error: String(error) })
    return null
  }
}
