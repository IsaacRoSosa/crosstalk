// Lyrics from LRCLIB, a free and open lyrics database with a public API (no key).
// https://lrclib.net/docs
import { log } from './log'

const LRCLIB_API = 'https://lrclib.net/api'
// LRCLIB asks clients to identify themselves (identified clients get higher rate limits)
const USER_AGENT = 'Crosstalk/0.1 (https://github.com/IsaacRoSosa/crosstalk)'
const SCOPE = 'lrclib'

interface LrclibRecord {
  id: number
  trackName: string
  artistName: string
  albumName: string | null
  duration: number
  instrumental: boolean
  plainLyrics: string | null
}

export type LyricsFailureReason = 'lyrics_not_found' | 'instrumental' | 'lyrics_service_failed'

export interface LyricsResult {
  lyrics: string | null
  reason?: LyricsFailureReason
}

export interface LyricsQuery {
  title: string
  artist: string
  album?: string | null
  durationMs?: number | null
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// "Song - Remastered 2011", "Song (feat. X)" -> "Song"
function cleanTitle(title: string): string {
  return title
    .replace(/\s+-\s+.*(remaster|version|live|edit|mix|mono|stereo|deluxe).*$/i, '')
    .replace(/\s*[([](feat\.?|ft\.?|with)\s[^)\]]*[)\]]/gi, '')
    .trim()
}

async function lrclibGet(path: string, params: Record<string, string>, retried = false): Promise<Response> {
  const response = await fetch(`${LRCLIB_API}${path}?${new URLSearchParams(params)}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(12_000),
  })
  if (response.status === 429 && !retried) {
    // Honor Retry-After (with some jitter), as LRCLIB asks; retry once
    const retryAfter = Number(response.headers.get('Retry-After')) || 2
    const waitMs = Math.min(retryAfter, 10) * 1000 * (1 + Math.random() * 0.3)
    log.warn(SCOPE, 'rate limited, retrying', { path, waitMs: Math.round(waitMs) })
    await new Promise((resolve) => setTimeout(resolve, waitMs))
    return lrclibGet(path, params, true)
  }
  return response
}

function toResult(record: LrclibRecord): LyricsResult {
  if (record.instrumental || !record.plainLyrics) {
    return { lyrics: null, reason: 'instrumental' }
  }
  return { lyrics: record.plainLyrics.trim() }
}

export async function findLyrics(query: LyricsQuery): Promise<LyricsResult> {
  const label = `${query.title} - ${query.artist}`
  const durationSec = query.durationMs ? Math.round(query.durationMs / 1000) : null

  try {
    // 1. Exact match by title, artist, album and duration (±2 s)
    const exactParams: Record<string, string> = { track_name: query.title, artist_name: query.artist }
    if (query.album) exactParams.album_name = query.album
    if (durationSec && durationSec >= 1 && durationSec <= 3600) exactParams.duration = String(durationSec)

    const exact = await lrclibGet('/get', exactParams)
    if (exact.ok) {
      const result = toResult((await exact.json()) as LrclibRecord)
      log.info(SCOPE, result.lyrics ? 'found exact match' : 'exact match is instrumental', { track: label })
      return result
    }
    if (exact.status !== 404) {
      log.warn(SCOPE, 'get request failed', { track: label, status: exact.status })
    }

    // 2. Search with a cleaned-up title and pick the best record by the same artist
    const search = await lrclibGet('/search', { track_name: cleanTitle(query.title), artist_name: query.artist })
    if (!search.ok) {
      log.warn(SCOPE, 'search request failed', { track: label, status: search.status })
      return { lyrics: null, reason: 'lyrics_service_failed' }
    }

    const records = (await search.json()) as LrclibRecord[]
    const wantedArtist = normalize(query.artist)
    const sameArtist = records.filter((r) => {
      const artist = normalize(r.artistName)
      return artist.includes(wantedArtist) || wantedArtist.includes(artist)
    })
    const byDuration = (r: LrclibRecord) => (durationSec ? Math.abs(r.duration - durationSec) : 0)
    const best = sameArtist.filter((r) => r.plainLyrics).sort((a, b) => byDuration(a) - byDuration(b))[0]

    if (best) {
      log.info(SCOPE, 'found via search', {
        track: label,
        matched: `${best.trackName} - ${best.artistName}`,
        durationDiffSec: durationSec ? Math.abs(best.duration - durationSec) : null,
      })
      return toResult(best)
    }

    const instrumental = sameArtist.some((r) => r.instrumental)
    log.info(SCOPE, instrumental ? 'track is instrumental' : 'no lyrics found', {
      track: label,
      searchResults: records.length,
      sameArtistResults: sameArtist.length,
    })
    return { lyrics: null, reason: instrumental ? 'instrumental' : 'lyrics_not_found' }
  } catch (error) {
    log.error(SCOPE, 'request threw', { track: label, error: String(error) })
    return { lyrics: null, reason: 'lyrics_service_failed' }
  }
}
