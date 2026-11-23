import { describe, expect, it } from 'vitest'
import { normalizeName, pickSong } from './song-match'

const r = (title: string, artist: string, durationMs: number | null = null) => ({ title, artist, durationMs })

describe('pickSong', () => {
  it('matches title and artist, ignoring accents, feat and remaster tails', () => {
    expect(normalizeName('Canción (feat. Bad Bunny) - Remastered 2011')).toBe('cancion')
    expect(pickSong({ title: 'Dreamer', artist: 'Laufey', durationMs: 211000 }, [r('Dreamer', 'Other'), r('Dreamer', 'Laufey', 212000)])).toEqual(r('Dreamer', 'Laufey', 212000))
    expect(pickSong({ title: 'Watch the Throne', artist: 'Kanye West & JAY-Z', durationMs: null }, [r('Watch The Throne', 'JAY-Z')])).not.toBeNull()
  })
  it('prefers the closest length and refuses wrong songs', () => {
    const live = r('Champion', 'Kanye West', 260000)
    const studio = r('Champion', 'Kanye West', 167000)
    expect(pickSong({ title: 'Champion', artist: 'Kanye West', durationMs: 168000 }, [live, studio])).toBe(studio)
    expect(pickSong({ title: 'Champion', artist: 'Kanye West', durationMs: null }, [r('Stronger', 'Kanye West'), r('Champion', 'Queen')])).toBeNull()
  })
})
