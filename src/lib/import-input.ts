// Finds the Spotify, Deezer and Apple Music links in whatever the user pasted. Works with one link, many links
// (one per line, separated by spaces, or even glued together, as happens when pasting several
// lines into a single-line input), and with spotify:track: URIs. Also reads the rows the Apple Music
// app on the Mac copies (title, time, artist, album... separated by tabs), which have no link.
// Pure and dependency-free, so it runs in the browser and on the server.

export interface ParsedImportInput {
  spotifyTrackIds: string[]
  spotifyPlaylistIds: string[]
  deezerTrackIds: number[]
  deezerPlaylistIds: number[]
  deezerShortLinks: string[]
  // Apple Music ids come with the storefront from the link (e.g. "mx"), which the API needs
  appleMusicSongs: AppleMusicRef[]
  appleMusicPlaylists: AppleMusicRef[]
  // Album links without a song (?i=): a whole album isn't imported, so these only explain that
  appleMusicAlbumCount: number
  // Songs pasted as rows from the Apple Music app, found later by title and artist
  songRows: PastedSongRow[]
}

export interface PastedSongRow {
  title: string
  artist: string
  album: string | null
  durationMs: number | null
  // The row as pasted, so an unfinished import can hand it back
  line: string
}

export interface AppleMusicRef {
  storefront: string
  id: string
}

const SPOTIFY_ID = '([A-Za-z0-9]{22})'
const SPOTIFY_TRACK = new RegExp(`(?:open\\.spotify\\.com/(?:intl-[a-z-]+/)?track/|spotify:track:)${SPOTIFY_ID}`, 'g')
const SPOTIFY_PLAYLIST = new RegExp(`(?:open\\.spotify\\.com/(?:intl-[a-z-]+/)?playlist/|spotify:playlist:)${SPOTIFY_ID}`, 'g')
const DEEZER_TRACK = /deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?track\/(\d+)/g
const DEEZER_PLAYLIST = /deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?playlist\/(\d+)/g
const DEEZER_SHORT_LINK = /https:\/\/(?:link\.deezer\.com|deezer\.page\.link)\/[A-Za-z0-9/_-]+/g
// music.apple.com/mx/song/name/123, /song/123, /album/name/456?i=123 (the song in an album),
// /playlist/name/pl.u-abc. Numeric ids stop at the next letter, so glued links still split.
const APPLE_HOST = '(?:music|geo\\.music|itunes)\\.apple\\.com/([a-z]{2})'
const APPLE_SONG = new RegExp(`${APPLE_HOST}/song/(?:[^/?#\\s]+/)?(\\d+)`, 'g')
const APPLE_ALBUM_SONG = new RegExp(`${APPLE_HOST}/album/(?:[^/?#\\s]+/)?\\d+\\?(?:[^#\\s]*?&)?i=(\\d+)`, 'g')
const APPLE_ALBUM = new RegExp(`${APPLE_HOST}/album/(?:[^/?#\\s]+/)?\\d+`, 'g')
const APPLE_PLAYLIST = new RegExp(`${APPLE_HOST}/playlist/(?:[^/?#\\s]+/)?(pl\\.(?:u-)?[A-Za-z0-9]+?)(?=https?:|[^A-Za-z0-9]|$)`, 'g')

const DURATION = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/

function parseDuration(value: string): number | null {
  const m = value.match(DURATION)
  if (!m) return null
  const [h, mm, ss] = m[3] !== undefined ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, Number(m[1]), Number(m[2])]
  return ((h * 60 + mm) * 60 + ss) * 1000
}

// Rows copied from a playlist in the Apple Music app: "Dreamer\t\t3:31\tLaufey\tBewitched\tJazz\t0".
// The columns depend on what the person shows, so the time column is the anchor: the title comes
// before it and the artist and album after it. Without a time column: title, artist, album.
function parseSongRows(text: string): PastedSongRow[] {
  const rows: PastedSongRow[] = []
  const seen = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.includes('\t') || /https?:\/\//.test(raw)) continue
    const cells = raw.split('\t').map((cell) => cell.trim())
    const timeIndex = cells.findIndex((cell) => DURATION.test(cell))
    let title: string | undefined
    let rest: string[]
    if (timeIndex > 0) {
      title = cells.slice(0, timeIndex).find(Boolean)
      rest = cells.slice(timeIndex + 1).filter(Boolean)
    } else {
      const filled = cells.filter(Boolean)
      title = filled[0]
      rest = filled.slice(1)
    }
    const artist = rest[0]
    if (!title || !artist || /^\d+$/.test(artist)) continue
    const key = `${title}\u0000${artist}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      title,
      artist,
      album: rest[1] && !/^\d+$/.test(rest[1]) ? rest[1] : null,
      durationMs: timeIndex > 0 ? parseDuration(cells[timeIndex]) : null,
      line: raw.trim(),
    })
  }
  return rows
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function matches(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((m) => m[1] ?? m[0])
}

// One entry per id (the first link's storefront wins)
function appleRefs(text: string, ...patterns: RegExp[]): AppleMusicRef[] {
  const byId = new Map<string, AppleMusicRef>()
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      if (!byId.has(m[2])) byId.set(m[2], { storefront: m[1], id: m[2] })
    }
  }
  return [...byId.values()]
}

export function parseImportInput(text: string): ParsedImportInput {
  const appleAlbumSongLinks = [...text.matchAll(APPLE_ALBUM_SONG)].length
  return {
    spotifyTrackIds: unique(matches(text, SPOTIFY_TRACK)),
    spotifyPlaylistIds: unique(matches(text, SPOTIFY_PLAYLIST)),
    deezerTrackIds: unique(matches(text, DEEZER_TRACK).map(Number)),
    deezerPlaylistIds: unique(matches(text, DEEZER_PLAYLIST).map(Number)),
    deezerShortLinks: unique(matches(text, DEEZER_SHORT_LINK)),
    appleMusicSongs: appleRefs(text, APPLE_SONG, APPLE_ALBUM_SONG),
    appleMusicPlaylists: appleRefs(text, APPLE_PLAYLIST),
    appleMusicAlbumCount: Math.max(0, [...text.matchAll(APPLE_ALBUM)].length - appleAlbumSongLinks),
    songRows: parseSongRows(text),
  }
}

export function isEmptyImport(parsed: ParsedImportInput): boolean {
  return (
    parsed.spotifyTrackIds.length === 0 &&
    parsed.spotifyPlaylistIds.length === 0 &&
    parsed.deezerTrackIds.length === 0 &&
    parsed.deezerPlaylistIds.length === 0 &&
    parsed.deezerShortLinks.length === 0 &&
    parsed.appleMusicSongs.length === 0 &&
    parsed.appleMusicPlaylists.length === 0 &&
    parsed.appleMusicAlbumCount === 0 &&
    parsed.songRows.length === 0
  )
}
