// Adds songs to a user's nucleus. Songs are analysed once and kept in the shared catalog, so a song
// someone else already added (from Spotify or Deezer) is reused without calling Genius or the AI again.

import { HttpError } from './http'
import { requireEnv } from './env'
import { fetchSpotifyMetadata } from './spotify'
import { fetchDeezerTrack, type DeezerTrack } from './deezer'
import { searchGeniusLyrics } from './genius'
import { analyzeLyricsWithRotation, getGeminiApiKeys } from './gemini'
import {
  addTrackToNucleus,
  findAnalyzedTrackByIsrc,
  findTrackByDeezerId,
  findTrackBySpotifyId,
  getNucleusTrackAddedAt,
  linkTrackSource,
  saveCatalogTrack,
  toTrack,
} from './repository'
import { getAdminClient } from './supabase/server'
import type { UserContext } from './session'
import type { TrackRow } from './supabase/database.types'
import { isEmotion, type SpotifyMetadata, type Track } from '../types/track'

const ANALYSIS_MODEL = 'gemini-2.5-flash'

export type AddTrackResult = { status: 'added'; track: Track } | { status: 'already_in_nucleus'; track: Track }

// What we know about a song before analysing it, whatever the source
interface TrackCandidate {
  spotify_id?: string
  deezer_id?: number
  isrc: string | null
  title: string
  artist: string
  album: string | null
  cover_url: string | null
  duration_ms: number | null
}

function clamp01(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  return Math.min(1, Math.max(0, n))
}

function fromSpotify(metadata: SpotifyMetadata): TrackCandidate {
  return {
    spotify_id: metadata.id,
    isrc: metadata.external_ids?.isrc ?? null,
    title: metadata.name,
    artist: metadata.artists[0]?.name || 'Unknown artist',
    album: metadata.album?.name ?? null,
    cover_url: metadata.album?.images?.[0]?.url ?? null,
    duration_ms: metadata.duration_ms > 0 ? metadata.duration_ms : null,
  }
}

function fromDeezer(track: DeezerTrack): TrackCandidate {
  return {
    deezer_id: track.id,
    isrc: track.isrc ?? null,
    title: track.title,
    artist: track.artist?.name || 'Unknown artist',
    album: track.album?.title ?? null,
    cover_url: track.album?.cover_xl ?? track.album?.cover_big ?? null,
    duration_ms: track.duration > 0 ? track.duration * 1000 : null,
  }
}

async function linkToNucleus(ctx: UserContext, row: TrackRow): Promise<AddTrackResult> {
  const existing = await getNucleusTrackAddedAt(ctx.db, ctx.nucleus.id, row.id)
  if (existing) {
    return { status: 'already_in_nucleus', track: toTrack(row, existing) }
  }
  const addedAt = await addTrackToNucleus(ctx.db, ctx.nucleus.id, row.id)
  return { status: 'added', track: toTrack(row, addedAt) }
}

async function analyzeCandidate(candidate: TrackCandidate, existingId?: number): Promise<TrackRow> {
  const lyricsResult = await searchGeniusLyrics(candidate.title, candidate.artist, requireEnv('GENIUS_ACCESS_TOKEN'))
  if (!lyricsResult.lyrics) {
    throw new HttpError(422, 'No lyrics found for this track. Unable to analyze emotion.')
  }

  const geminiApiKeys = getGeminiApiKeys()
  if (geminiApiKeys.length === 0) {
    throw new Error('No Gemini API keys configured')
  }
  // Lyrics are only used here, for the analysis. They are not stored.
  const analysis = await analyzeLyricsWithRotation(lyricsResult.lyrics, candidate.title, candidate.artist, geminiApiKeys)
  const emotion = typeof analysis.emotion === 'string' ? analysis.emotion.toLowerCase().trim() : analysis.emotion
  if (!isEmotion(emotion)) {
    throw new HttpError(502, 'The AI returned an unexpected analysis. Please try again.')
  }

  return saveCatalogTrack(
    getAdminClient(),
    {
      ...candidate,
      genius_url: lyricsResult.url,
      emotion,
      valence: clamp01(analysis.valence),
      energy: clamp01(analysis.energy),
      genre: analysis.genre || null,
      mood_description: analysis.mood_description || null,
      lyrical_style: analysis.vocal_characteristics || null,
      analysis_model: ANALYSIS_MODEL,
      analyzed_at: new Date().toISOString(),
    },
    existingId,
  )
}

// Reuses the catalog when possible (same source id, or same ISRC from the other source); analyses otherwise.
async function addCandidate(ctx: UserContext, candidate: TrackCandidate, sameSourceRow: TrackRow | null): Promise<AddTrackResult> {
  if (sameSourceRow?.analyzed_at) {
    return linkToNucleus(ctx, sameSourceRow)
  }

  if (candidate.isrc) {
    const sameRecording = await findAnalyzedTrackByIsrc(ctx.db, candidate.isrc)
    if (sameRecording) {
      const missingIds = {
        ...(candidate.spotify_id && !sameRecording.spotify_id ? { spotify_id: candidate.spotify_id } : {}),
        ...(candidate.deezer_id && !sameRecording.deezer_id ? { deezer_id: candidate.deezer_id } : {}),
      }
      if (Object.keys(missingIds).length > 0) {
        await linkTrackSource(getAdminClient(), sameRecording.id, missingIds)
      }
      return linkToNucleus(ctx, sameRecording)
    }
  }

  const row = await analyzeCandidate(candidate, sameSourceRow?.id)
  return linkToNucleus(ctx, row)
}

export async function addSpotifyTrack(ctx: UserContext, spotifyId: string): Promise<AddTrackResult> {
  const known = await findTrackBySpotifyId(ctx.db, spotifyId)
  if (known?.analyzed_at) {
    return linkToNucleus(ctx, known)
  }

  let metadata: SpotifyMetadata
  try {
    metadata = await fetchSpotifyMetadata(spotifyId, requireEnv('SPOTIFY_CLIENT_ID'), requireEnv('SPOTIFY_CLIENT_SECRET'))
  } catch (error) {
    console.error(`Error fetching Spotify track ${spotifyId}:`, error)
    throw new HttpError(502, 'Could not get this track from Spotify')
  }
  return addCandidate(ctx, fromSpotify(metadata), known)
}

// Accepts a Deezer track id, or a track object from a playlist listing (which lacks the ISRC)
export async function addDeezerTrack(ctx: UserContext, track: number | DeezerTrack): Promise<AddTrackResult> {
  const deezerId = typeof track === 'number' ? track : track.id
  const known = await findTrackByDeezerId(ctx.db, deezerId)
  if (known?.analyzed_at) {
    return linkToNucleus(ctx, known)
  }

  let full: DeezerTrack
  try {
    full = await fetchDeezerTrack(deezerId)
  } catch (error) {
    console.error(`Error fetching Deezer track ${deezerId}:`, error)
    throw new HttpError(502, 'Could not get this track from Deezer')
  }
  return addCandidate(ctx, fromDeezer(full), known)
}
