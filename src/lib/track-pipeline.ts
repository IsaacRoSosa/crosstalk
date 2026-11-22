// Adds songs to a user's nucleus. Songs are analysed once and kept in the shared catalog, so a song
// someone else already added (from Spotify or Deezer) is reused without calling Genius or the AI again.

import { HttpError } from './http'
import { requireEnv } from './env'
import { fetchSpotifyMetadata } from './spotify'
import { fetchDeezerTrack, type DeezerTrack } from './deezer'
import { findGeniusSongUrl } from './genius'
import { findLyrics } from './lrclib'
import { analyzeLyrics } from './ai/analysis'
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
import { log } from './log'
import type { NucleusContext } from './session'
import type { TrackRow } from './supabase/database.types'
import type { SpotifyMetadata, Track } from '../types/track'

export type AddTrackResult = { status: 'added'; track: Track } | { status: 'already_in_nucleus'; track: Track }

// Where the pipeline is with a song, so imports can show it to the user as it happens
export type PipelineProgress =
  | { stage: 'song'; song: { title: string; artist: string; cover_url: string | null }; cached: boolean }
  | { stage: 'lyrics' }
  | { stage: 'analysis' }

export type OnProgress = (progress: PipelineProgress) => void

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

function reportCached(row: TrackRow, onProgress?: OnProgress) {
  onProgress?.({ stage: 'song', song: { title: row.title, artist: row.artist, cover_url: row.cover_url }, cached: true })
}

async function linkToNucleus(ctx: NucleusContext, row: TrackRow): Promise<AddTrackResult> {
  const existing = await getNucleusTrackAddedAt(ctx.db, ctx.nucleus.id, row.id)
  if (existing) {
    return { status: 'already_in_nucleus', track: toTrack(row, existing) }
  }
  const addedAt = await addTrackToNucleus(ctx.db, ctx.nucleus.id, row.id)
  return { status: 'added', track: toTrack(row, addedAt) }
}

async function analyzeCandidate(
  ctx: NucleusContext,
  candidate: TrackCandidate,
  existingId: number | undefined,
  onProgress?: OnProgress,
): Promise<TrackRow> {
  // Check the AI connection first, so songs aren't looked up for nothing when it's missing
  const apiKey = await ctx.getAiKey()

  const label = `${candidate.title} - ${candidate.artist}`
  log.info('pipeline', 'analyzing new track', { track: label, spotifyId: candidate.spotify_id, deezerId: candidate.deezer_id })

  onProgress?.({ stage: 'lyrics' })
  const [lyricsResult, geniusUrl] = await Promise.all([
    findLyrics({
      title: candidate.title,
      artist: candidate.artist,
      album: candidate.album,
      durationMs: candidate.duration_ms,
    }),
    findGeniusSongUrl(candidate.title, candidate.artist, process.env.GENIUS_ACCESS_TOKEN),
  ])
  if (!lyricsResult.lyrics) {
    log.warn('pipeline', 'skipping track without lyrics', { track: label, reason: lyricsResult.reason })
    const message =
      lyricsResult.reason === 'instrumental'
        ? 'This track is instrumental, so there are no lyrics to analyze.'
        : lyricsResult.reason === 'lyrics_service_failed'
          ? "Couldn't reach the lyrics service. Please try again."
          : 'No lyrics found for this track. Unable to analyze emotion.'
    throw new HttpError(lyricsResult.reason === 'lyrics_service_failed' ? 502 : 422, message, {
      reason: lyricsResult.reason,
    })
  }

  // Lyrics are only used here, for the analysis. They are not stored.
  onProgress?.({ stage: 'analysis' })
  const analysis = await analyzeLyrics(ctx.userId, apiKey, {
    title: candidate.title,
    artist: candidate.artist,
    lyrics: lyricsResult.lyrics,
  })
  log.info('pipeline', 'track analyzed', { track: label, emotion: analysis.emotion, model: analysis.model })

  return saveCatalogTrack(
    getAdminClient(),
    {
      ...candidate,
      genius_url: geniusUrl,
      emotion: analysis.emotion,
      valence: analysis.valence,
      energy: analysis.energy,
      genre: analysis.genre || null,
      mood_description: analysis.mood_description || null,
      lyrical_style: analysis.lyrical_style || null,
      analysis_model: analysis.model,
      analyzed_at: new Date().toISOString(),
    },
    existingId,
  )
}

// Reuses the catalog when possible (same source id, or same ISRC from the other source); analyses otherwise.
async function addCandidate(
  ctx: NucleusContext,
  candidate: TrackCandidate,
  sameSourceRow: TrackRow | null,
  onProgress?: OnProgress,
): Promise<AddTrackResult> {
  onProgress?.({
    stage: 'song',
    song: { title: candidate.title, artist: candidate.artist, cover_url: candidate.cover_url },
    cached: false,
  })
  if (sameSourceRow?.analyzed_at) {
    log.info('pipeline', 'reusing analyzed track', { trackId: sameSourceRow.id, match: 'source id' })
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
      log.info('pipeline', 'reusing analyzed track', { trackId: sameRecording.id, match: 'isrc' })
      return linkToNucleus(ctx, sameRecording)
    }
  }

  const row = await analyzeCandidate(ctx, candidate, sameSourceRow?.id, onProgress)
  return linkToNucleus(ctx, row)
}

export async function addSpotifyTrack(ctx: NucleusContext, spotifyId: string, onProgress?: OnProgress): Promise<AddTrackResult> {
  const known = await findTrackBySpotifyId(ctx.db, spotifyId)
  if (known?.analyzed_at) {
    reportCached(known, onProgress)
    return linkToNucleus(ctx, known)
  }

  let metadata: SpotifyMetadata
  try {
    metadata = await fetchSpotifyMetadata(spotifyId, requireEnv('SPOTIFY_CLIENT_ID'), requireEnv('SPOTIFY_CLIENT_SECRET'))
  } catch (error) {
    console.error(`Error fetching Spotify track ${spotifyId}:`, error)
    throw new HttpError(502, 'Could not get this track from Spotify')
  }
  return addCandidate(ctx, fromSpotify(metadata), known, onProgress)
}

// Accepts a Deezer track id, or a track object from a playlist listing (which lacks the ISRC)
export async function addDeezerTrack(
  ctx: NucleusContext,
  track: number | DeezerTrack,
  onProgress?: OnProgress,
): Promise<AddTrackResult> {
  const deezerId = typeof track === 'number' ? track : track.id
  const known = await findTrackByDeezerId(ctx.db, deezerId)
  if (known?.analyzed_at) {
    reportCached(known, onProgress)
    return linkToNucleus(ctx, known)
  }

  let full: DeezerTrack
  try {
    full = await fetchDeezerTrack(deezerId)
  } catch (error) {
    console.error(`Error fetching Deezer track ${deezerId}:`, error)
    throw new HttpError(502, 'Could not get this track from Deezer')
  }
  return addCandidate(ctx, fromDeezer(full), known, onProgress)
}
