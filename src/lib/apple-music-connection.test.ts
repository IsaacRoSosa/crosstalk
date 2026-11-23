import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A tiny stand-in for the admin client's apple_music_connections table
const rows = new Map<string, { encrypted_token: string; storefront: string | null }>()
vi.mock('./supabase/server', () => ({
  getAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: rows.get(id) ?? null, error: null }) }) }),
      upsert: async (v: { user_id: string; encrypted_token: string; storefront: string | null }) => {
        rows.set(v.user_id, { encrypted_token: v.encrypted_token, storefront: v.storefront })
        return { error: null }
      },
      delete: () => ({ eq: async (_c: string, id: string) => (rows.delete(id), { error: null }) }),
    }),
  }),
}))

import { saveAppleMusicToken, withAppleMusicUser } from './apple-music-connection'
import { fetchLibraryPlaylistLines, fetchLibraryPlaylists } from './apple-music'
import { HttpError } from './http'

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const google = { userId: 'u1', isAnonymous: false } as never
const guest = { userId: 'g1', isAnonymous: true } as never
const req = (headers: Record<string, string> = {}) => new Request('http://x', { headers })

beforeEach(() => {
  rows.clear()
  vi.stubEnv('AI_KEY_ENCRYPTION_SECRET', randomBytes(32).toString('base64'))
  vi.stubEnv('APPLE_MUSIC_TEAM_ID', 'TEAM123456')
  vi.stubEnv('APPLE_MUSIC_KEY_ID', 'KEY1234567')
  vi.stubEnv('APPLE_MUSIC_PRIVATE_KEY', privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('apple music connection', () => {
  it('uses the saved token for a Google account, encrypted at rest', async () => {
    await saveAppleMusicToken('u1', 'user-token-123', 'mx')
    expect(rows.get('u1')?.encrypted_token).not.toContain('user-token-123')
    const user = await withAppleMusicUser(google, req(), async (u) => u)
    expect(user).toEqual({ userToken: 'user-token-123', storefront: 'mx', saved: true })
  })

  it('uses the sent token for a guest and refuses without one', async () => {
    const user = await withAppleMusicUser(guest, req({ 'X-Music-User-Token': 'guest-token', 'X-Music-Storefront': 'us' }), async (u) => u)
    expect(user).toEqual({ userToken: 'guest-token', storefront: 'us', saved: false })
    await expect(withAppleMusicUser(guest, req(), async (u) => u)).rejects.toMatchObject({ status: 428 })
  })

  it('reads playlists and lines with the user token, and forgets a refused token', async () => {
    await saveAppleMusicToken('u1', 'tok', 'mx')
    const seen: Array<[string, string | null]> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const h = init.headers as Record<string, string>
      seen.push([url, h['Music-User-Token']])
      if (url.endsWith('/me/library/playlists?limit=100'))
        return new Response(JSON.stringify({ data: [{ id: 'p.1', attributes: { name: 'Road trip' } }, { id: 'p.2', attributes: { name: 'Replay 2026' } }] }))
      if (url.includes('/me/library/playlists/p.2/tracks'))
        return new Response(JSON.stringify({ data: [
          { id: 'i.1', type: 'library-songs', attributes: { name: 'Dreamer', artistName: 'Laufey', playParams: { catalogId: '1690607895' } } },
          { id: 'i.2', type: 'library-songs', attributes: { name: 'Demo', artistName: 'Me', albumName: 'Home', durationInMillis: 95000 } },
        ] }))
      return new Response('{}', { status: 401 })
    }))
    const playlists = await withAppleMusicUser(google, req(), (u) => fetchLibraryPlaylists(u.userToken))
    expect(playlists.map((p) => p.name)).toEqual(['Replay 2026', 'Road trip'])
    const lines = await withAppleMusicUser(google, req(), (u) => fetchLibraryPlaylistLines(u.userToken, 'p.2', u.storefront))
    expect(lines).toEqual(['https://music.apple.com/mx/song/1690607895', 'Demo\t\t1:35\tMe\tHome'])
    expect(seen.every(([, token]) => token === 'tok')).toBe(true)

    const refused = withAppleMusicUser(google, req(), (u) => fetchLibraryPlaylistLines(u.userToken, 'p.9', u.storefront))
    await expect(refused).rejects.toBeInstanceOf(HttpError)
    await expect(refused).rejects.toMatchObject({ status: 401, body: { code: 'apple_music_reconnect' } })
    expect(rows.has('u1')).toBe(false)
  })
})
