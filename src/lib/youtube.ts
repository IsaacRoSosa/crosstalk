// Finds a playable YouTube video for a track (YouTube Data API search).
export async function searchYouTubeVideoId(query: string, apiKey: string): Promise<string | null> {
  const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&videoCategoryId=10&maxResults=1&key=${apiKey}`

  const response = await fetch(searchUrl)
  const result = await response.json()

  if (!response.ok) {
    throw new Error(result.error?.message || 'YouTube search failed')
  }

  return (result.items?.[0]?.id?.videoId as string | undefined) ?? null
}
