#!/usr/bin/env node
// Diagnoses lyrics lookup step by step for one song: Genius search API, the Genius song page
// (with and without browser-like headers) and LRCLIB, a free lyrics API, for comparison.
//
// Usage (Node 20.6+):
//   node --env-file=.env scripts/check-lyrics.mjs "Song title" "Artist"

const [title = 'Never Gonna Give You Up', artist = 'Rick Astley'] = process.argv.slice(2)
const token = process.env.GENIUS_ACCESS_TOKEN
const results = []

function record(step, result, detail = '') {
  results.push({ step, result, detail: String(detail).slice(0, 110) })
}

async function safeFetch(url, options) {
  try {
    const response = await fetch(url, options)
    const text = await response.text()
    return { status: response.status, text }
  } catch (error) {
    return { status: 0, text: String(error.cause?.message ?? error.message) }
  }
}

function countContainers(html) {
  return (html.match(/data-lyrics-container="true"/g) || []).length
}

function looksLikeChallenge(html) {
  return /Just a moment|cf-chl|challenge-platform|cf_chl_opt/i.test(html)
}

console.log(`Checking lyrics for "${title}" by ${artist}\n`)

// 1. Genius search API
let songUrl = null
if (!token) {
  record('Genius search API', 'SKIP', 'GENIUS_ACCESS_TOKEN not set')
} else {
  const { status, text } = await safeFetch(`https://api.genius.com/search?q=${encodeURIComponent(`${title} ${artist}`)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (status !== 200) {
    record('Genius search API', 'FAIL', `HTTP ${status} ${text}`)
  } else {
    const hits = JSON.parse(text).response?.hits?.filter((h) => h.type === 'song') ?? []
    if (hits.length === 0) {
      record('Genius search API', 'FAIL', 'no results')
    } else {
      songUrl = hits[0].result.url
      record('Genius search API', 'OK', `${hits[0].result.full_title} -> ${songUrl}`)
    }
  }
}

// 2. Genius song page, plain request (what the app did before) and with browser headers
if (songUrl) {
  const variants = [
    ['Genius page (plain fetch)', {}],
    [
      'Genius page (browser headers)',
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
    ],
  ]
  for (const [label, options] of variants) {
    const { status, text } = await safeFetch(songUrl, options)
    const containers = countContainers(text)
    const challenge = looksLikeChallenge(text)
    const ok = status === 200 && !challenge && containers > 0
    record(label, ok ? 'OK' : 'FAIL', `HTTP ${status} | ${text.length} bytes | lyrics containers: ${containers} | cloudflare challenge: ${challenge}`)
  }
}

// 3. LRCLIB (free lyrics API, no key)
{
  const params = new URLSearchParams({ track_name: title, artist_name: artist })
  const { status, text } = await safeFetch(`https://lrclib.net/api/search?${params}`, {
    headers: { 'User-Agent': 'Crosstalk lyrics check (https://github.com/IsaacRoSosa/crosstalk)' },
  })
  if (status !== 200) {
    record('LRCLIB search', 'FAIL', `HTTP ${status} ${text}`)
  } else {
    const items = JSON.parse(text)
    const withLyrics = items.find((i) => i.plainLyrics)
    record(
      'LRCLIB search',
      withLyrics ? 'OK' : 'FAIL',
      withLyrics
        ? `${items.length} results | "${withLyrics.trackName}" - ${withLyrics.artistName} | ${withLyrics.plainLyrics.length} characters`
        : `${items.length} results, none with lyrics`,
    )
  }
}

console.table(results)
