import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, HttpError, json } from '../../../lib/http'
import { requireEnv } from '../../../lib/env'
import { requireUser } from '../../../lib/session'
import { extractSpotifyPlaylistId, fetchPlaylistTracks } from '../../../lib/spotify'
import { addSpotifyTrack } from '../../../lib/track-pipeline'
import type { Track } from '../../../types/track'

// Number of tracks to add before stopping
const TARGET_SUCCESS = 25

// Note: since Spotify's 2026 Development Mode changes, playlist contents are only available
// for playlists the signed-in Spotify user owns, so this fails for app-only access.
// It will be replaced by pasting multiple track links and Deezer playlists.
export const Route = createFileRoute('/api/tracks/analyze-playlist')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const ctx = await requireUser(request)
          const { spotifyUrl } = await request.json()

          const playlistId = typeof spotifyUrl === 'string' ? extractSpotifyPlaylistId(spotifyUrl) : null
          if (!playlistId) {
            throw new HttpError(400, 'Invalid Spotify playlist URL')
          }

          let playlistTracks
          try {
            playlistTracks = await fetchPlaylistTracks(
              playlistId,
              requireEnv('SPOTIFY_CLIENT_ID'),
              requireEnv('SPOTIFY_CLIENT_SECRET'),
              100,
            )
          } catch (error) {
            console.error('Error fetching playlist from Spotify:', error)
            throw new HttpError(
              502,
              "Spotify no longer lets this app read playlists. Paste individual track links instead.",
            )
          }

          const success: Track[] = []
          const failed: Array<{ track: string; artist: string; reason: string }> = []
          const skipped: Array<{ track: string; artist: string; reason: string }> = []

          for (const metadata of playlistTracks) {
            if (success.length >= TARGET_SUCCESS) break

            const trackName = metadata.name
            const artistName = metadata.artists[0]?.name || 'Unknown Artist'

            try {
              const result = await addSpotifyTrack(ctx, metadata.id, metadata)
              if (result.status === 'already_in_nucleus') {
                skipped.push({ track: trackName, artist: artistName, reason: 'Already in collection' })
              } else {
                success.push(result.track)
              }
            } catch (error) {
              const reason = error instanceof HttpError ? error.message : 'Could not analyze this track'
              if (!(error instanceof HttpError)) console.error(`Error adding "${trackName}":`, error)
              failed.push({ track: trackName, artist: artistName, reason })
            }
          }

          return json({
            totalProcessed: success.length + skipped.length + failed.length,
            successCount: success.length,
            failedCount: failed.length,
            skippedCount: skipped.length,
            tracks: success,
            failed,
            skipped,
          })
        } catch (error) {
          return errorResponse(error, 'Error analyzing playlist')
        }
      },
    },
  },
})
