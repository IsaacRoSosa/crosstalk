import { generateKeyPairSync, verify } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDeveloperToken, fetchAppleMusicPlaylistSongs, fetchAppleMusicSong, toAppleMusicSong } from './apple-music'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })

beforeEach(() => {
  vi.stubEnv('APPLE_MUSIC_TEAM_ID', 'TEAM123456')
  vi.stubEnv('APPLE_MUSIC_KEY_ID', 'KEY1234567')
  // As it often arrives from an env var: one line with literal \n
  vi.stubEnv('APPLE_MUSIC_PRIVATE_KEY', privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().replace(/\n/g, '\\n'))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const song = (id: string, extra = {}) => ({
  id,
  type: 'songs',
  attributes: {
    name: `Song ${id}`,
    artistName: 'Artist',
    albumName: 'Album',
    isrc: `ISRC${id}`,
    durationInMillis: 200000,
    artwork: { url: 'https://is1.mzstatic.com/x/{w}x{h}bb.jpg' },
    ...extra,
  },
})

describe('developer token', () => {
  it('is an ES256 JWT Apple can verify', () => {
    const token = createDeveloperToken(1_000_000)
    const [h, p, s] = token.split('.')
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEY1234567' })
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toEqual({ iss: 'TEAM123456', iat: 1_000_000, exp: 1_043_200 })
    const ok = verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))
    expect(ok).toBe(true)
  })
})

describe('catalog', () => {
  it('maps a song', () => {
    expect(toAppleMusicSong(song('1'))).toEqual({
      id: '1', title: 'Song 1', artist: 'Artist', album: 'Album', isrc: 'ISRC1', durationMs: 200000,
      coverUrl: 'https://is1.mzstatic.com/x/600x600bb.jpg',
    })
    expect(toAppleMusicSong({ id: '2', type: 'music-videos', attributes: { name: 'x' } })).toBeNull()
  })

  it('falls back to the us storefront', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      urls.push(url)
      expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer ey/)
      return url.includes('/catalog/mx/')
        ? new Response('{}', { status: 404 })
        : new Response(JSON.stringify({ data: [song('5')] }))
    }))
    const result = await fetchAppleMusicSong('5', 'mx')
    expect(result.isrc).toBe('ISRC5')
    expect(urls).toEqual(['https://api.music.apple.com/v1/catalog/mx/songs/5', 'https://api.music.apple.com/v1/catalog/us/songs/5'])
  })

  it('pages through a playlist and skips videos', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url)
      if (url.includes('offset=100')) return new Response(JSON.stringify({ data: [song('3')] }))
      return new Response(JSON.stringify({
        data: [song('1'), { id: 'v', type: 'music-videos', attributes: { name: 'video' } }, song('2')],
        next: '/v1/catalog/mx/playlists/pl.u-abc/tracks?offset=100',
      }))
    }))
    const songs = await fetchAppleMusicPlaylistSongs('pl.u-abc', 'mx', 30)
    expect(songs.map((s) => s.id)).toEqual(['1', '2', '3'])
    expect(urls[1]).toBe('https://api.music.apple.com/v1/catalog/mx/playlists/pl.u-abc/tracks?offset=100')
  })
})
