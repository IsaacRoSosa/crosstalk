import { describe, expect, it } from 'vitest'
import { isEmptyImport, parseImportInput } from './import-input'
describe('apple music links', () => {
  it('songs, album songs, playlists, glued', () => {
    const t = 'https://music.apple.com/mx/song/blinding-lights/1488408568https://music.apple.com/us/album/after-hours/1499378108?i=1499378615\nhttps://music.apple.com/us/song/1440857781 https://music.apple.com/mx/playlist/replay-2026/pl.u-8aAVZAgC4bPmKjhttps://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb?l=es https://music.apple.com/us/album/x/123?l=en https://music.apple.com/mx/song/blinding-lights/1488408568'
    const p = parseImportInput(t)
    expect(p.appleMusicSongs).toEqual([{storefront:'mx',id:'1488408568'},{storefront:'us',id:'1440857781'},{storefront:'us',id:'1499378615'}])
    expect(p.appleMusicPlaylists).toEqual([{storefront:'mx',id:'pl.u-8aAVZAgC4bPmKj'},{storefront:'us',id:'pl.f4d106fed2bd41149aaacabb233eb5eb'}])
    expect(p.appleMusicAlbumCount).toBe(1)
    expect(p.spotifyTrackIds).toEqual([])
  })
  it('album only is not empty', () => {
    expect(isEmptyImport(parseImportInput('https://music.apple.com/us/album/x/123'))).toBe(false)
    expect(isEmptyImport(parseImportInput('hello'))).toBe(true)
  })
})
