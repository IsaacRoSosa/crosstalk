// Finds a playable YouTube video for a track (YouTube Data API search).
import { HttpError } from './http'
import { log } from './log'

export async function searchYouTubeVideoId(query: string, apiKey: string): Promise<string | null> {
  const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&videoCategoryId=10&maxResults=1&key=${apiKey}`

  let response: Response
  try {
    response = await fetch(searchUrl)
  } catch (error) {
    log.error('youtube', 'search request threw', { query, error: String(error) })
    throw new HttpError(502, "Couldn't reach YouTube. Please try again.")
  }

  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    // e.g. 403 quotaExceeded (the daily search quota is used up), 400 keyInvalid, 403 API not enabled
    const reason = result?.error?.errors?.[0]?.reason ?? result?.error?.status
    log.warn('youtube', 'search failed', { query, status: response.status, reason, message: result?.error?.message })
    throw new HttpError(
      502,
      reason === 'quotaExceeded'
        ? "YouTube's daily search limit was reached. Songs played before still work; new ones will tomorrow."
        : 'YouTube search is not available right now.',
      { code: 'youtube_failed', reason },
    )
  }

  const videoId = (result.items?.[0]?.id?.videoId as string | undefined) ?? null
  log.info('youtube', videoId ? 'video found' : 'no video found', { query, videoId })
  return videoId
}
