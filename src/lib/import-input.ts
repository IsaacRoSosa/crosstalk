// Finds the Spotify and Deezer links in whatever the user pasted. Works with one link, many links
// (one per line, separated by spaces, or even glued together, as happens when pasting several
// lines into a single-line input), and with spotify:track: URIs.
// Pure and dependency-free, so it runs in the browser and on the server.

export interface ParsedImportInput {
  spotifyTrackIds: string[]
  spotifyPlaylistIds: string[]
  deezerTrackIds: number[]
  deezerPlaylistIds: number[]
  deezerShortLinks: string[]
}

const SPOTIFY_ID = '([A-Za-z0-9]{22})'
const SPOTIFY_TRACK = new RegExp(`(?:open\\.spotify\\.com/(?:intl-[a-z-]+/)?track/|spotify:track:)${SPOTIFY_ID}`, 'g')
const SPOTIFY_PLAYLIST = new RegExp(`(?:open\\.spotify\\.com/(?:intl-[a-z-]+/)?playlist/|spotify:playlist:)${SPOTIFY_ID}`, 'g')
const DEEZER_TRACK = /deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?track\/(\d+)/g
const DEEZER_PLAYLIST = /deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?playlist\/(\d+)/g
const DEEZER_SHORT_LINK = /https:\/\/(?:link\.deezer\.com|deezer\.page\.link)\/[A-Za-z0-9/_-]+/g

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function matches(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((m) => m[1] ?? m[0])
}

export function parseImportInput(text: string): ParsedImportInput {
  return {
    spotifyTrackIds: unique(matches(text, SPOTIFY_TRACK)),
    spotifyPlaylistIds: unique(matches(text, SPOTIFY_PLAYLIST)),
    deezerTrackIds: unique(matches(text, DEEZER_TRACK).map(Number)),
    deezerPlaylistIds: unique(matches(text, DEEZER_PLAYLIST).map(Number)),
    deezerShortLinks: unique(matches(text, DEEZER_SHORT_LINK)),
  }
}

export function isEmptyImport(parsed: ParsedImportInput): boolean {
  return (
    parsed.spotifyTrackIds.length === 0 &&
    parsed.spotifyPlaylistIds.length === 0 &&
    parsed.deezerTrackIds.length === 0 &&
    parsed.deezerPlaylistIds.length === 0 &&
    parsed.deezerShortLinks.length === 0
  )
}
