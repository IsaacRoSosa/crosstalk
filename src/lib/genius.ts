// Lyrics from Genius: the API finds the song page, then the lyrics are read from the page HTML
// (Genius's API doesn't return lyrics). Every step logs what happened, and the result says why
// lyrics weren't found, because "no lyrics" can mean very different things.
import { log } from './log'

interface GeniusSearchResponse {
  response: {
    hits: Array<{
      type: string
      result: {
        id: number
        title: string
        url: string
        primary_artist: { name: string }
      }
    }>
  }
}

export type LyricsFailureReason =
  | 'genius_search_failed' // the API call failed (bad token, rate limit, blocked...)
  | 'genius_no_results' // the search returned no songs
  | 'genius_page_blocked' // Genius refused to serve the song page (403, Cloudflare challenge...)
  | 'genius_page_failed' // the page request failed for another reason
  | 'genius_no_lyrics_in_page' // the page loaded but the lyrics markup wasn't found (layout changed, or no lyrics)

export interface LyricsResult {
  lyrics: string | null
  url: string | null
  reason?: LyricsFailureReason
}

const SCOPE = 'genius'

// Genius tends to block requests that don't look like a browser
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export async function searchGeniusLyrics(title: string, artist: string, accessToken: string): Promise<LyricsResult> {
  const query = `${title} ${artist}`
  let data: GeniusSearchResponse

  try {
    const response = await fetch(`https://api.genius.com/search?q=${encodeURIComponent(query)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      log.warn(SCOPE, 'search request failed', { query, status: response.status, body: body.slice(0, 200) })
      return { lyrics: null, url: null, reason: 'genius_search_failed' }
    }
    data = (await response.json()) as GeniusSearchResponse
  } catch (error) {
    log.error(SCOPE, 'search request threw', { query, error: String(error) })
    return { lyrics: null, url: null, reason: 'genius_search_failed' }
  }

  const songs = (data.response?.hits ?? []).filter((hit) => hit.type === 'song').map((hit) => hit.result)
  if (songs.length === 0) {
    log.info(SCOPE, 'no search results', { query })
    return { lyrics: null, url: null, reason: 'genius_no_results' }
  }

  // Prefer a result by the same artist; the first hit is sometimes a cover, a translation or another song
  const wantedArtist = normalize(artist)
  const song =
    songs.find((s) => {
      const hitArtist = normalize(s.primary_artist.name)
      return hitArtist.includes(wantedArtist) || wantedArtist.includes(hitArtist)
    }) ?? songs[0]

  log.info(SCOPE, 'picked search result', {
    query,
    picked: `${song.title} - ${song.primary_artist.name}`,
    url: song.url,
    artistMatched: song !== songs[0] || normalize(songs[0].primary_artist.name).includes(wantedArtist),
    candidates: songs.slice(0, 3).map((s) => `${s.title} - ${s.primary_artist.name}`),
  })

  const page = await scrapeLyrics(song.url)
  return { lyrics: page.lyrics, url: song.url, reason: page.reason }
}

// Returns the inner HTML of every <div data-lyrics-container="true">, counting nested divs so a
// div inside the container doesn't cut the lyrics short.
function extractLyricsContainers(html: string): string[] {
  const containers: string[] = []
  const opener = /<div[^>]*data-lyrics-container="true"[^>]*>/g
  let match: RegExpExecArray | null

  while ((match = opener.exec(html)) !== null) {
    const start = match.index + match[0].length
    const tag = /<div\b[^>]*>|<\/div>/g
    tag.lastIndex = start
    let depth = 1
    let end = -1
    let t: RegExpExecArray | null
    while ((t = tag.exec(html)) !== null) {
      depth += t[0].startsWith('</') ? -1 : 1
      if (depth === 0) {
        end = t.index
        break
      }
    }
    if (end === -1) break
    containers.push(html.slice(start, end))
    opener.lastIndex = end
  }

  return containers
}

function htmlToText(fragment: string): string {
  return fragment
    // Genius puts headers and other non-lyric bits inside the container, marked like this
    .replace(/<div[^>]*data-exclude-from-selection="true"[^>]*>[\s\S]*?<\/div>/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function scrapeLyrics(songUrl: string): Promise<{ lyrics: string | null; reason?: LyricsFailureReason }> {
  let html: string
  try {
    const response = await fetch(songUrl, { headers: BROWSER_HEADERS })
    html = await response.text()
    const looksLikeChallenge = /Just a moment|cf-chl|challenge-platform|cf_chl_opt/i.test(html)

    if (!response.ok || looksLikeChallenge) {
      log.warn(SCOPE, 'song page not served', {
        url: songUrl,
        status: response.status,
        cloudflareChallenge: looksLikeChallenge,
        bytes: html.length,
      })
      return { lyrics: null, reason: response.status === 403 || looksLikeChallenge ? 'genius_page_blocked' : 'genius_page_failed' }
    }
  } catch (error) {
    log.error(SCOPE, 'song page request threw', { url: songUrl, error: String(error) })
    return { lyrics: null, reason: 'genius_page_failed' }
  }

  const containers = extractLyricsContainers(html)
  const lyrics = htmlToText(containers.join('\n\n'))

  if (!lyrics) {
    log.warn(SCOPE, 'no lyrics in song page', {
      url: songUrl,
      bytes: html.length,
      containers: containers.length,
      hasInstrumentalNotice: /This song is an instrumental/i.test(html),
    })
    return { lyrics: null, reason: 'genius_no_lyrics_in_page' }
  }

  log.info(SCOPE, 'lyrics extracted', { url: songUrl, containers: containers.length, characters: lyrics.length })
  return { lyrics }
}
