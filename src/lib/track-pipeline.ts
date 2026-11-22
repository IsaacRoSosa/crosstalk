// Adds a Spotify track to a user's nucleus. Songs are analysed once and kept in the shared
// catalog, so a song someone else already added is reused without calling Genius or the AI again.

import { HttpError } from './http'
import { requireEnv } from './env'
import { fetchSpotifyMetadata } from './spotify'
import { searchGeniusLyrics } from './genius'
import { analyzeLyricsWithRotation, getGeminiApiKeys } from './gemini'
import { addTrackToNucleus, findTrackBySpotifyId, getNucleusTrackAddedAt, saveCatalogTrack, toTrack } from './repository'
import { getAdminClient } from './supabase/server'
import type { UserContext } from './session'
import { isEmotion, type SpotifyMetadata, type Track } from '../types/track'

const ANALYSIS_MODEL = 'gemini-2.5-flash'

export type AddTrackResult = { status: 'added'; track: Track } | { status: 'already_in_nucleus'; track: Track }

function clamp01(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  return Math.min(1, Math.max(0, n))
}

export async function addSpotifyTrack(
  ctx: UserContext,
  spotifyId: string,
  knownMetadata?: SpotifyMetadata,
): Promise<AddTrackResult> {
  let row = await findTrackBySpotifyId(ctx.db, spotifyId)

  if (row) {
    const addedAt = await getNucleusTrackAddedAt(ctx.db, ctx.nucleus.id, row.id)
    if (addedAt) {
      return { status: 'already_in_nucleus', track: toTrack(row, addedAt) }
    }
  }

  if (!row || !row.analyzed_at) {
    const metadata =
      knownMetadata ??
      (await fetchSpotifyMetadata(spotifyId, requireEnv('SPOTIFY_CLIENT_ID'), requireEnv('SPOTIFY_CLIENT_SECRET')))
    const title = metadata.name
    const artist = metadata.artists[0]?.name || 'Unknown artist'

    const lyricsResult = await searchGeniusLyrics(title, artist, requireEnv('GENIUS_ACCESS_TOKEN'))
    if (!lyricsResult.lyrics) {
      throw new HttpError(422, 'No lyrics found for this track. Unable to analyze emotion.')
    }

    const geminiApiKeys = getGeminiApiKeys()
    if (geminiApiKeys.length === 0) {
      throw new Error('No Gemini API keys configured')
    }
    // Lyrics are only used here, for the analysis. They are not stored.
    const analysis = await analyzeLyricsWithRotation(lyricsResult.lyrics, title, artist, geminiApiKeys)
    const emotion = typeof analysis.emotion === 'string' ? analysis.emotion.toLowerCase().trim() : analysis.emotion
    if (!isEmotion(emotion)) {
      throw new HttpError(502, 'The AI returned an unexpected analysis. Please try again.')
    }

    row = await saveCatalogTrack(
      getAdminClient(),
      {
        spotify_id: spotifyId,
        isrc: metadata.external_ids?.isrc ?? null,
        title,
        artist,
        album: metadata.album?.name ?? null,
        cover_url: metadata.album?.images?.[0]?.url ?? null,
        duration_ms: metadata.duration_ms > 0 ? metadata.duration_ms : null,
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
      row?.id,
    )
  }

  const addedAt = await addTrackToNucleus(ctx.db, ctx.nucleus.id, row.id)
  return { status: 'added', track: toTrack(row, addedAt) }
}
