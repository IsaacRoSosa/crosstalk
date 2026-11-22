// Sharing a nucleus by link (server only). The owner turns sharing on and gets /s/<token>; anyone
// with the link sees a read-only copy: the name, the first impression and the songs with what was
// read in each. Never the owner's account, chat or AI connection. Turning sharing off clears the
// token, so the old link stops working; sharing again makes a new one.
import { randomBytes } from 'node:crypto'
import { listNucleusTracks } from './repository'
import { getAdminClient, type Db } from './supabase/server'
import type { Track } from '../types/track'

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/

export interface SharedNucleus {
  name: string
  impression: string | null
  dominantEmotion: string | null
  tracks: Track[]
}

export function isShareToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value)
}

// 16 random bytes, base64url: 22 characters, not guessable
function newShareToken(): string {
  return randomBytes(16).toString('base64url')
}

// Turns sharing on (as the owner: Row Level Security applies) and returns the token. Keeps the
// current token when the nucleus is already shared, so links already sent keep working.
export async function enableSharing(db: Db, nucleusId: number, currentToken: string | null): Promise<string> {
  if (currentToken) return currentToken
  const token = newShareToken()
  const { error } = await db
    .from('nuclei')
    .update({ share_token: token, shared_at: new Date().toISOString() })
    .eq('id', nucleusId)
  if (error) throw error
  return token
}

export async function disableSharing(db: Db, nucleusId: number): Promise<void> {
  const { error } = await db.from('nuclei').update({ share_token: null, shared_at: null }).eq('id', nucleusId)
  if (error) throw error
}

// What a visitor with the link may see, or null when the link doesn't exist or was turned off.
// Visitors have no session, so this reads with the admin client and returns only public fields.
export async function loadSharedNucleus(token: string): Promise<SharedNucleus | null> {
  if (!isShareToken(token)) return null
  const admin = getAdminClient()
  const { data: nucleus, error } = await admin
    .from('nuclei')
    .select('id, name, impression, dominant_emotion')
    .eq('share_token', token)
    .maybeSingle()
  if (error) throw error
  if (!nucleus) return null

  const tracks = await listNucleusTracks(admin, nucleus.id)
  return {
    name: nucleus.name,
    impression: nucleus.impression,
    dominantEmotion: nucleus.dominant_emotion,
    // Catalog ids stay (the galaxy keys songs by id); source ids and the video aren't needed here
    tracks: tracks.map((track) => ({ ...track, spotify_id: null, deezer_id: null, isrc: null, youtube_video_id: null })),
  }
}
