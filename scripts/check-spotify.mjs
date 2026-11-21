#!/usr/bin/env node
// Checks which Spotify Web API endpoints Crosstalk depends on still work for this app
// (Spotify restricted Development Mode apps in Feb/Mar 2026), and compares with Deezer's
// public API as a fallback.
//
// Usage (Node 20.6+):
//   node --env-file=.env scripts/check-spotify.mjs [spotify playlist or track URLs...]
//
// Tip: pass one public playlist you own and one owned by someone else, e.g.
//   node --env-file=.env scripts/check-spotify.mjs https://open.spotify.com/playlist/XXXX https://open.spotify.com/playlist/YYYY

const DEFAULT_TRACK = '4uLU6hMCjMI75M1A2tKUQC'
const DEFAULT_PLAYLISTS = ['37i9dQZF1DXcBWIGoYBM5M'] // Spotify editorial playlist (blocked for new apps since Nov 2024)

const clientId = process.env.SPOTIFY_CLIENT_ID
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET
if (!clientId || !clientSecret) {
  console.error('Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET. Run with: node --env-file=.env scripts/check-spotify.mjs')
  process.exit(1)
}

const args = process.argv.slice(2)
const trackIds = args.map((u) => u.match(/track\/([a-zA-Z0-9]+)/)?.[1]).filter(Boolean)
const playlistIds = args.map((u) => u.match(/playlist\/([a-zA-Z0-9]+)/)?.[1]).filter(Boolean)
if (trackIds.length === 0) trackIds.push(DEFAULT_TRACK)
if (playlistIds.length === 0) playlistIds.push(...DEFAULT_PLAYLISTS)

const results = []
function record(check, status, detail) {
  const ok = status >= 200 && status < 300
  results.push({ check, status, result: ok ? 'OK' : 'FAIL', detail })
}

async function getJson(url, headers = {}) {
  try {
    const res = await fetch(url, { headers })
    let body = null
    try { body = await res.json() } catch { /* ignore */ }
    return { status: res.status, body }
  } catch (error) {
    return { status: 0, body: { error: String(error) } }
  }
}

function errorText(body) {
  if (!body) return ''
  const e = body.error
  if (!e) return ''
  return typeof e === 'string' ? e : `${e.message ?? ''}${e.reason ? ` (${e.reason})` : ''}`
}

// 1. Token (client credentials)
const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
  },
  body: 'grant_type=client_credentials',
}).catch((error) => {
  console.error(`Could not reach Spotify: ${error.cause?.message ?? error.message}`)
  process.exit(1)
})
const tokenBody = await tokenRes.json().catch(() => ({}))
record('Spotify token (client credentials)', tokenRes.status, tokenRes.ok ? '' : tokenBody.error_description ?? tokenBody.error ?? '')
if (!tokenRes.ok) {
  console.table(results)
  console.error('\nCould not get a token. Check the credentials and that the app owner still has Spotify Premium.')
  process.exit(1)
}
const auth = { Authorization: `Bearer ${tokenBody.access_token}` }

// 2. Single track
let isrc = null
for (const id of trackIds) {
  const { status, body } = await getJson(`https://api.spotify.com/v1/tracks/${id}`, auth)
  isrc = isrc ?? body?.external_ids?.isrc ?? null
  record(
    `GET /tracks/${id}`,
    status,
    status === 200
      ? `"${body.name}" - ${body.artists?.[0]?.name} | cover: ${body.album?.images?.length ? 'yes' : 'no'} | isrc: ${body.external_ids?.isrc ?? 'missing'} | preview_url: ${body.preview_url ? 'yes' : 'no'}`
      : errorText(body),
  )
}

// 3. Several tracks (removed in Feb 2026 for dev mode)
{
  const { status, body } = await getJson(`https://api.spotify.com/v1/tracks?ids=${trackIds.join(',')}`, auth)
  record('GET /tracks?ids= (batch)', status, status === 200 ? `${body.tracks?.length} tracks` : errorText(body))
}

// 4. Playlists
for (const id of playlistIds) {
  const meta = await getJson(`https://api.spotify.com/v1/playlists/${id}?fields=name,owner(display_name),public`, auth)
  record(`GET /playlists/${id} (metadata)`, meta.status, meta.status === 200 ? `"${meta.body.name}" by ${meta.body.owner?.display_name}` : errorText(meta.body))

  for (const path of ['tracks', 'items']) {
    const { status, body } = await getJson(`https://api.spotify.com/v1/playlists/${id}/${path}?limit=5`, auth)
    record(`GET /playlists/${id}/${path}`, status, status === 200 ? `${body.items?.length ?? 0} items returned (total ${body.total ?? '?'})` : errorText(body))
  }
}

// 5. Search limits (max dropped from 50 to 10 for dev mode)
for (const limit of [10, 20]) {
  const { status, body } = await getJson(`https://api.spotify.com/v1/search?q=radiohead&type=track&limit=${limit}`, auth)
  record(`GET /search limit=${limit}`, status, status === 200 ? `${body.tracks?.items?.length} results` : errorText(body))
}

// 6. Deezer public API (no key) as fallback
if (isrc) {
  const { status, body } = await getJson(`https://api.deezer.com/track/isrc:${isrc}`)
  const found = status === 200 && !body?.error
  record(`Deezer GET /track/isrc:${isrc}`, found ? 200 : status || 404, found ? `"${body.title}" | cover: ${body.album?.cover_xl ? 'yes' : 'no'} | preview: ${body.preview ? 'yes' : 'no'}` : JSON.stringify(body?.error ?? ''))
}
{
  const { status, body } = await getJson('https://api.deezer.com/playlist/908622995/tracks?limit=5')
  const ok = status === 200 && !body?.error
  record('Deezer GET /playlist/{id}/tracks', ok ? 200 : status || 404, ok ? `${body.data?.length} items returned (total ${body.total ?? '?'})` : JSON.stringify(body?.error ?? ''))
}

console.table(results)
