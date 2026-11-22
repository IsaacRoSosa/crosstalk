// Patterns across a nucleus's songs, worked out in code so the AI only has to put them into words.
// Used for the first impression and as context for the chat.
import { EMOTIONS, type Track } from '../types/track'

const pct = (n: number, total: number) => `${Math.round((n / total) * 100)}%`

function countBy<T>(items: T[], key: (item: T) => string | null | undefined): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const item of items) {
    const k = key(item)
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

function average(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null)
  return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null
}

function describeLevel(value: number | null, low: string, mid: string, high: string): string {
  if (value === null) return 'unknown'
  return `${value < 0.38 ? low : value > 0.62 ? high : mid} (${value.toFixed(2)})`
}

// The song furthest from the nucleus's average mood: often the most telling one
function outlier(tracks: Track[], avgValence: number | null, avgEnergy: number | null): Track | null {
  if (tracks.length < 5 || avgValence === null || avgEnergy === null) return null
  let best: Track | null = null
  let bestDistance = 0
  for (const t of tracks) {
    if (t.valence === null || t.energy === null) continue
    const d = Math.hypot(t.valence - avgValence, t.energy - avgEnergy)
    if (d > bestDistance) {
      best = t
      bestDistance = d
    }
  }
  return bestDistance > 0.35 ? best : null
}

export function describeNucleusFacts(tracks: Track[]): string {
  const total = tracks.length
  const lines: string[] = []

  const artists = countBy(tracks, (t) => t.artist)
  lines.push(
    `- ${total} songs by ${artists.length} artists` +
      (artists[0] && artists[0][1] > 1 ? `; most played artist: ${artists[0][0]} (${artists[0][1]} songs)` : ''),
  )

  // A mixed song counts half for its second feeling
  const feelings = new Map<string, number>()
  for (const t of tracks) {
    feelings.set(t.emotion, (feelings.get(t.emotion) ?? 0) + 1)
    if (t.secondary_emotion) feelings.set(t.secondary_emotion, (feelings.get(t.secondary_emotion) ?? 0) + 0.5)
  }
  const feelingTotal = [...feelings.values()].reduce((a, b) => a + b, 0)
  const sortedFeelings = [...feelings.entries()].sort((a, b) => b[1] - a[1])
  lines.push(`- main feelings: ${sortedFeelings.slice(0, 4).map(([e, n]) => `${e} ${pct(n, feelingTotal)}`).join(', ')}`)
  const missing = EMOTIONS.filter((e) => !feelings.has(e))
  if (missing.length) lines.push(`- never: ${missing.join(', ')}`)
  const mixed = tracks.filter((t) => t.secondary_emotion)
  if (mixed.length >= 2) {
    const pairs = countBy(mixed, (t) => `${t.emotion} + ${t.secondary_emotion}`)
    lines.push(`- mixed feelings in ${pct(mixed.length, total)} of songs, most often ${pairs[0][0]}`)
  }

  const withAddressee = tracks.filter((t) => t.addressee)
  if (withAddressee.length >= 3) {
    const to = countBy(withAddressee, (t) => t.addressee)
    lines.push(`- who the songs are sung to: ${to.slice(0, 4).map(([a, n]) => `${a} ${pct(n, withAddressee.length)}`).join(', ')}`)
  }
  const withStance = tracks.filter((t) => t.stance)
  if (withStance.length >= 3) {
    const stances = countBy(withStance, (t) => t.stance)
    lines.push(`- the singer's attitude: ${stances.slice(0, 4).map(([s, n]) => `${s} ${pct(n, withStance.length)}`).join(', ')}`)
  }
  const themes = countBy(tracks.flatMap((t) => t.themes.map((theme) => ({ theme }))), (x) => x.theme).filter(([, n]) => n > 1)
  if (themes.length) lines.push(`- recurring themes: ${themes.slice(0, 6).map(([t, n]) => `${t} (${n})`).join(', ')}`)

  const avgValence = average(tracks.map((t) => t.valence))
  const avgEnergy = average(tracks.map((t) => t.energy))
  lines.push(
    `- lyrics lean ${describeLevel(avgValence, 'dark', 'in between', 'bright')}, intensity ${describeLevel(avgEnergy, 'low', 'medium', 'high')}`,
  )

  const genres = countBy(tracks, (t) => t.genre?.toLowerCase())
  if (genres.length) {
    lines.push(`- genres: ${genres.slice(0, 4).map(([g, n]) => `${g} (${n})`).join(', ')}${genres.length > 4 ? `, ${genres.length} in total` : ''}`)
  }

  const odd = outlier(tracks, avgValence, avgEnergy)
  if (odd) lines.push(`- the one that doesn't fit: "${odd.title}" by ${odd.artist} (${odd.emotion})`)

  return lines.join('\n')
}

// One line per song, for prompts. Capped so big nuclei stay within a sensible prompt size.
export function describeSongs(tracks: Track[], max = 40): string {
  return tracks
    .slice(0, max)
    .map((t) => {
      const feeling = t.secondary_emotion ? `${t.emotion}/${t.secondary_emotion}` : t.emotion
      const to = t.addressee ? `, to ${t.addressee}` : ''
      return `- "${t.title}" by ${t.artist} · ${feeling}${to}${t.mood_description ? ` · ${t.mood_description.slice(0, 160)}` : ''}`
    })
    .join('\n')
}
