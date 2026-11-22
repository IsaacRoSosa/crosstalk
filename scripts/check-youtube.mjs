#!/usr/bin/env node
// Checks the YouTube Data API key used to find a video for each song.
// Usage (Node 20.6+): node --env-file=.env scripts/check-youtube.mjs ["song artist"]
const query = process.argv[2] ?? 'Jesus Walks Kanye West official audio'
const key = process.env.YOUTUBE_API_KEY
if (!key) {
  console.error('YOUTUBE_API_KEY is not set in .env')
  process.exit(1)
}
const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&videoCategoryId=10&maxResults=1&key=${key}`
const response = await fetch(url).catch((error) => {
  console.error(`Could not reach YouTube: ${error.cause?.message ?? error.message}`)
  process.exit(1)
})
const body = await response.json().catch(() => ({}))
if (response.ok) {
  const item = body.items?.[0]
  console.log(item ? `OK: "${item.snippet.title}" -> https://youtu.be/${item.id.videoId}` : 'OK, but no results for that query')
} else {
  const reason = body.error?.errors?.[0]?.reason ?? body.error?.status
  console.log(`FAIL: HTTP ${response.status} (${reason}) ${body.error?.message ?? ''}`)
  if (reason === 'quotaExceeded') console.log('The daily search quota is used up; it resets at midnight Pacific time.')
  if (reason === 'keyInvalid' || response.status === 400) console.log('The key is invalid or was deleted: create a new one in Google Cloud > APIs & Services > Credentials.')
  if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED') console.log('Enable "YouTube Data API v3" for the Google Cloud project that owns this key.')
}
