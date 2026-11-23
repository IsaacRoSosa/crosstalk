// Picks the search result that is really the song someone pasted by name (title and artist, from
// rows copied out of the Apple Music app). Pure, so it's easy to test.

export interface SongQuery {
  title: string
  artist: string
  durationMs: number | null
}

export interface SongResult {
  title: string
  artist: string
  durationMs: number | null
}

// Lowercase, no accents, no "(feat. ...)" / "- Remastered" tails, no punctuation
export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function sameName(a: string, b: string): boolean {
  const x = normalizeName(a)
  const y = normalizeName(b)
  return x.length > 0 && (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `))
}

// "Kanye West & Jay-Z" should match a result credited to "Kanye West"
function sameArtist(pasted: string, found: string): boolean {
  const split = (value: string) =>
    normalizeName(value)
      .split(/\s+(?:and|feat|ft|featuring|x|with)\s+|,/)
      .map((part) => part.trim())
      .filter(Boolean)
  const found_ = split(found)
  return split(pasted).some((name) => found_.some((other) => other === name || other.startsWith(`${name} `) || name.startsWith(`${other} `)))
}

// The best result whose title and artist both match, preferring the closest length. Null when
// nothing matches well enough: adding a different song would be worse than skipping it.
export function pickSong<T extends SongResult>(query: SongQuery, results: T[]): T | null {
  const matches = results.filter((r) => sameName(r.title, query.title) && sameArtist(query.artist, r.artist))
  if (matches.length === 0) return null
  if (query.durationMs === null) return matches[0]
  const distance = (r: T) => (r.durationMs === null ? 60_000 : Math.abs(r.durationMs - (query.durationMs as number)))
  return [...matches].sort((a, b) => distance(a) - distance(b))[0]
}
