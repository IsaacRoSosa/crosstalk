// Data access for Crosstalk on Supabase.
// Functions that take `db` run as the signed-in user (Row Level Security applies);
// functions that take `admin` write the shared catalog and must only be called on the server.

import { isEmotion, type Track } from '../types/track'
import type { ChatMessage } from '../types/chat'
import type { Db } from './supabase/server'
import type { NucleusRow, TrackInsert, TrackRow } from './supabase/database.types'

const UNIQUE_VIOLATION = '23505'

// ---------------------------------------------------------------------------
// Nuclei
// ---------------------------------------------------------------------------

export async function getOrCreateNucleus(db: Db, userId: string): Promise<NucleusRow> {
  const { data, error } = await db
    .from('nuclei')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (data) return data

  // Normally created by the on_auth_user_created trigger; this covers users created before it existed.
  const { data: created, error: insertError } = await db
    .from('nuclei')
    .insert({ user_id: userId })
    .select('*')
    .single()
  if (insertError) throw insertError
  return created
}

export async function updateNucleus(
  db: Db,
  nucleusId: number,
  patch: { name?: string; dominant_emotion?: string | null },
): Promise<NucleusRow> {
  const { data, error } = await db.from('nuclei').update(patch).eq('id', nucleusId).select('*').single()
  if (error) throw error
  return data
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

export function toTrack(row: TrackRow, addedAt: string): Track {
  return {
    id: row.id,
    spotify_id: row.spotify_id,
    deezer_id: row.deezer_id,
    isrc: row.isrc,
    title: row.title,
    artist: row.artist,
    album: row.album,
    cover_url: row.cover_url,
    duration_ms: row.duration_ms,
    youtube_video_id: row.youtube_video_id,
    genius_url: row.genius_url,
    emotion: isEmotion(row.emotion) ? row.emotion : 'calm',
    valence: row.valence,
    energy: row.energy,
    genre: row.genre,
    mood_description: row.mood_description,
    lyrical_style: row.lyrical_style,
    added_at: addedAt,
  }
}

// Tracks in a nucleus, newest first
export async function listNucleusTracks(db: Db, nucleusId: number): Promise<Track[]> {
  const { data, error } = await db
    .from('nucleus_tracks')
    .select('added_at, track:tracks(*)')
    .eq('nucleus_id', nucleusId)
    .order('added_at', { ascending: false })
  if (error) throw error

  return data.flatMap((row) => {
    const track = row.track as TrackRow | null
    return track && track.analyzed_at ? [toTrack(track, row.added_at)] : []
  })
}

export async function getCatalogTrack(db: Db, trackId: number): Promise<TrackRow | null> {
  const { data, error } = await db.from('tracks').select('*').eq('id', trackId).maybeSingle()
  if (error) throw error
  return data
}

export async function findTrackBySpotifyId(db: Db, spotifyId: string): Promise<TrackRow | null> {
  const { data, error } = await db.from('tracks').select('*').eq('spotify_id', spotifyId).maybeSingle()
  if (error) throw error
  return data
}

export async function findTrackByDeezerId(db: Db, deezerId: number): Promise<TrackRow | null> {
  const { data, error } = await db.from('tracks').select('*').eq('deezer_id', deezerId).maybeSingle()
  if (error) throw error
  return data
}

// The same recording on Spotify and Deezer shares its ISRC, so this matches a song across sources
export async function findAnalyzedTrackByIsrc(db: Db, isrc: string): Promise<TrackRow | null> {
  const { data, error } = await db
    .from('tracks')
    .select('*')
    .eq('isrc', isrc)
    .not('analyzed_at', 'is', null)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

// Saves a track in the shared catalog. If another request inserted the same song first, returns that row.
export async function saveCatalogTrack(admin: Db, values: TrackInsert, existingId?: number): Promise<TrackRow> {
  if (existingId !== undefined) {
    const { data, error } = await admin.from('tracks').update(values).eq('id', existingId).select('*').single()
    if (error) throw error
    return data
  }

  const { data, error } = await admin.from('tracks').insert(values).select('*').single()
  if (!error) return data
  if (error.code === UNIQUE_VIOLATION) {
    const existing =
      (values.spotify_id ? await findTrackBySpotifyId(admin, values.spotify_id) : null) ??
      (values.deezer_id ? await findTrackByDeezerId(admin, values.deezer_id) : null)
    if (existing) return existing
  }
  throw error
}

// Records another source id (e.g. the Deezer id of a song first added from Spotify).
// Best effort: if that id already belongs to another catalog row, it is left as is.
export async function linkTrackSource(
  admin: Db,
  trackId: number,
  ids: { spotify_id?: string; deezer_id?: number },
): Promise<void> {
  const { error } = await admin.from('tracks').update(ids).eq('id', trackId)
  if (error && error.code !== UNIQUE_VIOLATION) throw error
}

export async function setTrackVideo(admin: Db, trackId: number, youtubeVideoId: string): Promise<void> {
  const { error } = await admin.from('tracks').update({ youtube_video_id: youtubeVideoId }).eq('id', trackId)
  if (error) throw error
}

// Returns when the track was added to the nucleus, or null if it isn't in it
export async function getNucleusTrackAddedAt(db: Db, nucleusId: number, trackId: number): Promise<string | null> {
  const { data, error } = await db
    .from('nucleus_tracks')
    .select('added_at')
    .eq('nucleus_id', nucleusId)
    .eq('track_id', trackId)
    .maybeSingle()
  if (error) throw error
  return data?.added_at ?? null
}

export async function addTrackToNucleus(db: Db, nucleusId: number, trackId: number): Promise<string> {
  const { data, error } = await db
    .from('nucleus_tracks')
    .insert({ nucleus_id: nucleusId, track_id: trackId })
    .select('added_at')
    .single()
  if (error) throw error
  return data.added_at
}

export async function removeTrackFromNucleus(db: Db, nucleusId: number, trackId: number): Promise<void> {
  const { error } = await db.from('nucleus_tracks').delete().eq('nucleus_id', nucleusId).eq('track_id', trackId)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

function toChatMessage(row: { id: number; role: string; content: string; created_at: string }): ChatMessage {
  return { id: row.id, role: row.role === 'user' ? 'user' : 'assistant', content: row.content, created_at: row.created_at }
}

// Messages in chronological order. With `limit`, only the most recent ones.
export async function listMessages(db: Db, nucleusId: number, limit?: number): Promise<ChatMessage[]> {
  let query = db
    .from('chat_messages')
    .select('id, role, content, created_at')
    .eq('nucleus_id', nucleusId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
  if (limit !== undefined) query = query.limit(limit)

  const { data, error } = await query
  if (error) throw error
  return data.map(toChatMessage).reverse()
}

export async function addMessages(
  db: Db,
  nucleusId: number,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('chat_messages')
    .insert(messages.map((m) => ({ nucleus_id: nucleusId, role: m.role, content: m.content })))
    .select('id, role, content, created_at')
  if (error) throw error
  return data.map(toChatMessage)
}

export async function clearMessages(db: Db, nucleusId: number): Promise<void> {
  const { error } = await db.from('chat_messages').delete().eq('nucleus_id', nucleusId)
  if (error) throw error
}
