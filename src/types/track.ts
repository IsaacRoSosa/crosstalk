export const EMOTIONS = ['joy', 'sadness', 'anger', 'fear', 'love', 'surprise', 'calm', 'nostalgia'] as const

export type Emotion = (typeof EMOTIONS)[number]

export function isEmotion(value: unknown): value is Emotion {
  return typeof value === 'string' && (EMOTIONS as readonly string[]).includes(value)
}

// Who the singer is talking to
export const ADDRESSEES = ['ex', 'partner', 'crush', 'self', 'friend', 'family', 'everyone', 'nobody'] as const
export type Addressee = (typeof ADDRESSEES)[number]

// The singer's attitude
export const STANCES = [
  'longing',
  'defiant',
  'resigned',
  'euphoric',
  'bitter',
  'tender',
  'anxious',
  'detached',
  'playful',
  'reflective',
  'confident',
] as const
export type Stance = (typeof STANCES)[number]

export function oneOf<T extends string>(list: readonly T[], value: unknown): T | null {
  const v = typeof value === 'string' ? value.toLowerCase().trim() : value
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null
}

// A catalog track as it appears in a user's nucleus
export interface Track {
  id: number
  spotify_id: string | null
  deezer_id: number | null
  // Optional so hand-made example tracks don't need it
  apple_music_id?: string | null
  isrc: string | null
  title: string
  artist: string
  album: string | null
  cover_url: string | null
  duration_ms: number | null
  youtube_video_id: string | null
  genius_url: string | null
  emotion: Emotion
  // Set when the song is genuinely mixed
  secondary_emotion: Emotion | null
  addressee: Addressee | null
  stance: Stance | null
  themes: string[]
  valence: number | null
  energy: number | null
  genre: string | null
  // One short line on what the song is really doing
  mood_description: string | null
  // A few words on how it's written
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
