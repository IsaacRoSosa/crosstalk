import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, HttpError, json } from '../../../lib/http'
import { requireUser } from '../../../lib/session'
import { isEmptyImport, parseImportInput } from '../../../lib/import-input'
import { fetchDeezerPlaylistTracks, resolveDeezerShortLink, type DeezerTrack } from '../../../lib/deezer'
import { addDeezerTrack, addSpotifyTrack, type AddTrackResult } from '../../../lib/track-pipeline'
import type { Track } from '../../../types/track'

// Stop after adding this many tracks in one import
const TARGET_SUCCESS = 25
// Upper bound on songs looked at per import (some fail, e.g. instrumentals without lyrics)
const MAX_ATTEMPTS = 40
const MAX_INPUT_LENGTH = 50_000

const SPOTIFY_PLAYLIST_HELP =
  "Spotify doesn't let apps read playlists anymore. Open the playlist in the Spotify desktop app, select the songs (Cmd/Ctrl+A), copy them (Cmd/Ctrl+C) and paste them here. Deezer playlist links also work."

interface ImportJob {
  label: string
  run: () => Promise<AddTrackResult>
}

// Adds the songs in whatever the user pasted: Spotify track links (one or many),
// Deezer track or playlist links. Spotify playlists can't be read anymore (see SPOTIFY_PLAYLIST_HELP).
export const Route = createFileRoute('/api/tracks/import')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const ctx = await requireUser(request)
          const body = await request.json()
          const input = typeof body.input === 'string' ? body.input.slice(0, MAX_INPUT_LENGTH) : ''

          const parsed = parseImportInput(input)

          for (const shortLink of parsed.deezerShortLinks) {
            const resolved = await resolveDeezerShortLink(shortLink)
            if (resolved) {
              const fromShortLink = parseImportInput(resolved)
              parsed.deezerTrackIds.push(...fromShortLink.deezerTrackIds)
              parsed.deezerPlaylistIds.push(...fromShortLink.deezerPlaylistIds)
            }
          }

          if (isEmptyImport(parsed)) {
            throw new HttpError(400, 'Paste Spotify song links or a Deezer playlist link.')
          }

          const hasImportableLinks =
            parsed.spotifyTrackIds.length > 0 || parsed.deezerTrackIds.length > 0 || parsed.deezerPlaylistIds.length > 0
          if (!hasImportableLinks) {
            throw new HttpError(422, parsed.spotifyPlaylistIds.length > 0 ? SPOTIFY_PLAYLIST_HELP : 'No songs found in that link.')
          }

          const jobs: ImportJob[] = []
          for (const id of parsed.spotifyTrackIds) {
            jobs.push({ label: `Spotify track ${id}`, run: () => addSpotifyTrack(ctx, id) })
          }
          for (const id of new Set(parsed.deezerTrackIds)) {
            jobs.push({ label: `Deezer track ${id}`, run: () => addDeezerTrack(ctx, id) })
          }
          for (const playlistId of new Set(parsed.deezerPlaylistIds)) {
            let playlistTracks: DeezerTrack[]
            try {
              playlistTracks = await fetchDeezerPlaylistTracks(playlistId, MAX_ATTEMPTS)
            } catch (error) {
              console.error(`Error fetching Deezer playlist ${playlistId}:`, error)
              throw new HttpError(502, "Couldn't read that Deezer playlist. Make sure it's public.")
            }
            for (const track of playlistTracks) {
              jobs.push({ label: `${track.title} - ${track.artist?.name ?? ''}`, run: () => addDeezerTrack(ctx, track) })
            }
          }

          const success: Track[] = []
          const skipped: Array<{ track: string; artist: string; reason: string }> = []
          const failed: Array<{ track: string; artist: string; reason: string }> = []

          // Sequential on purpose: keeps us well inside Genius, Gemini and Deezer rate limits,
          // and lets the client show tracks appearing one by one while it polls.
          for (const job of jobs.slice(0, MAX_ATTEMPTS)) {
            if (success.length >= TARGET_SUCCESS) break
            try {
              const result = await job.run()
              if (result.status === 'added') {
                success.push(result.track)
              } else {
                skipped.push({ track: result.track.title, artist: result.track.artist, reason: 'Already in collection' })
              }
            } catch (error) {
              if (!(error instanceof HttpError)) console.error(`Error importing ${job.label}:`, error)
              failed.push({
                track: job.label,
                artist: '',
                reason: error instanceof HttpError ? error.message : 'Could not analyze this track',
              })
            }
          }

          return json({
            totalProcessed: success.length + skipped.length + failed.length,
            successCount: success.length,
            skippedCount: skipped.length,
            failedCount: failed.length,
            tracks: success,
            skipped,
            failed,
            notice: parsed.spotifyPlaylistIds.length > 0 ? SPOTIFY_PLAYLIST_HELP : undefined,
          })
        } catch (error) {
          return errorResponse(error, 'Error importing tracks')
        }
      },
    },
  },
})
