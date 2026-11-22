export const EMOTIONS = ['joy', 'sadness', 'anger', 'fear', 'love', 'surprise', 'calm', 'nostalgia'] as const

export type Emotion = (typeof EMOTIONS)[number]

export function isEmotion(value: unknown): value is Emotion {
  return typeof value === 'string' && (EMOTIONS as readonly string[]).includes(value)
}

// A catalog track as it appears in a user's nucleus
export interface Track {
  id: number
  spotify_id: string | null
  deezer_id: number | null
  isrc: string | null
  title: string
  artist: string
  album: string | null
  cover_url: string | null
  duration_ms: number | null
  youtube_video_id: string | null
  genius_url: string | null
  emotion: Emotion
  valence: number | null
  energy: number | null
  genre: string | null
  mood_description: string | null
  lyrical_style: string | null
  // When the track was added to this nucleus
  added_at: string
}

export interface SpotifyMetadata {
  id: string
  name: string
  artists: { name: string }[]
  duration_ms: number
  album: {
    name?: string
    images: { url: string; height: number; width: number }[]
  }
  external_ids?: {
    isrc?: string
  }
  external_urls?: {
    spotify: string
  }
}
