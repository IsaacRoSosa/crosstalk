// Reading someone's Apple Music library (pure helpers, shared by the server and the browser):
// their playlists, and a playlist's songs as lines the import already understands.

export interface LibraryPlaylist {
  id: string
  name: string
  artworkUrl: string | null
}

export interface LibraryPlaylistResource {
  id: string
  attributes?: { name?: string; artwork?: { url?: string } }
}

export interface LibrarySongResource {
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

// Apple's "Replay", "Heavy Rotation" and the like first: they're what someone actually plays
const SUGGESTED = /replay|heavy rotation|on repeat|top 25|favorite|favourite|favoritas|más escuchad/i

export function isSuggestedPlaylist(name: string): boolean {
  return SUGGESTED.test(name)
}

export function toLibraryPlaylists(resources: LibraryPlaylistResource[]): LibraryPlaylist[] {
  const playlists = resources
    .filter((p) => p.attributes?.name)
    .map((p) => ({
      id: p.id,
      name: p.attributes?.name as string,
      artworkUrl: p.attributes?.artwork?.url?.replace('{w}', '80').replace('{h}', '80') ?? null,
    }))
  return [...playlists.filter((p) => isSuggestedPlaylist(p.name)), ...playlists.filter((p) => !isSuggestedPlaylist(p.name))]
}

function formatTime(ms: number | undefined): string {
  if (!ms || ms <= 0) return ''
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

// One line per song, in playlist order: a catalog song link, or (for songs Apple has no catalog entry
// for, e.g. uploaded ones) a title/artist row like those copied from the Mac app
export function songsToImportLines(songs: LibrarySongResource[], storefront: string): string[] {
  const lines: string[] = []
  for (const song of songs) {
    if (song.type !== 'library-songs') continue
    const catalogId = song.relationships?.catalog?.data?.[0]?.id ?? song.attributes?.playParams?.catalogId
    const a = song.attributes
    if (catalogId) {
      lines.push(`https://music.apple.com/${storefront}/song/${catalogId}`)
    } else if (a?.name && a.artistName) {
      lines.push(
        [a.name, '', formatTime(a.durationInMillis), a.artistName, a.albumName ?? ''].map((c) => c.replace(/[\t\n\r]/g, ' ')).join('\t'),
      )
    }
  }
  return lines
}
