import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, HttpError, json } from '../../../lib/http'
import { requireNucleus, requireUser } from '../../../lib/session'
import { isEmptyImport, parseImportInput } from '../../../lib/import-input'
import { fetchDeezerPlaylistTracks, resolveDeezerShortLink, type DeezerTrack } from '../../../lib/deezer'
import { addDeezerTrack, addSpotifyTrack, type AddTrackResult } from '../../../lib/track-pipeline'
import { log } from '../../../lib/log'
import type { Track } from '../../../types/track'

// Stop after adding this many tracks in one import
const TARGET_SUCCESS = 25
// Upper bound on songs looked at per import (some fail, e.g. instrumentals without lyrics)
const MAX_ATTEMPTS = 40
const MAX_INPUT_LENGTH = 50_000
// Serverless functions get cut off (Vercel Hobby: 300 s). Stop starting new songs after this long
// and hand the rest back to the client, which sends them in the next request. One song can take
// ~2 minutes in the worst case (slow free model + a retry), so this leaves room for it to finish.
const TIME_BUDGET_MS = Number(process.env.IMPORT_TIME_BUDGET_MS) || 150_000

const SPOTIFY_PLAYLIST_HELP =
  "Spotify doesn't let apps read playlists anymore. Open the playlist in the Spotify desktop app, select the songs (Cmd/Ctrl+A), copy them (Cmd/Ctrl+C) and paste them here. Deezer playlist links also work."

interface ImportJob {
  label: string
  // A link that imports this same song, used to hand unfinished songs back to the client
  link: string
  run: () => Promise<AddTrackResult>
}

function clampCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

// Adds to the nucleus `nucleusId` the songs in whatever the user pasted: Spotify track links (one or many),
// Deezer track or playlist links. Spotify playlists can't be read anymore (see SPOTIFY_PLAYLIST_HELP).
//
// Resumable: if the time budget runs out, the response carries `remaining` (links for the songs not
// tried yet). The client posts it back as `input` with the running totals in `alreadyAdded` and
// `alreadyAttempted`, so the 25-song / 40-attempt limits apply to the whole import, not each request.
export const Route = createFileRoute('/api/tracks/import')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json()
          const ctx = await requireNucleus(await requireUser(request), body.nucleusId)
          const input = typeof body.input === 'string' ? body.input.slice(0, MAX_INPUT_LENGTH) : ''
          const targetSuccess = Math.max(0, TARGET_SUCCESS - clampCount(body.alreadyAdded))
          const maxAttempts = Math.max(0, MAX_ATTEMPTS - clampCount(body.alreadyAttempted))
          const startedAt = Date.now()

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
            jobs.push({ label: `Spotify track ${id}`, link: `https://open.spotify.com/track/${id}`, run: () => addSpotifyTrack(ctx, id) })
          }
          for (const id of new Set(parsed.deezerTrackIds)) {
            jobs.push({ label: `Deezer track ${id}`, link: `https://www.deezer.com/track/${id}`, run: () => addDeezerTrack(ctx, id) })
          }
          for (const playlistId of new Set(parsed.deezerPlaylistIds)) {
            let playlistTracks: DeezerTrack[]
            try {
              playlistTracks = await fetchDeezerPlaylistTracks(playlistId, Math.max(1, maxAttempts))
            } catch (error) {
              console.error(`Error fetching Deezer playlist ${playlistId}:`, error)
              throw new HttpError(502, "Couldn't read that Deezer playlist. Make sure it's public.")
            }
            for (const track of playlistTracks) {
              jobs.push({
                label: `${track.title} - ${track.artist?.name ?? ''}`,
                link: `https://www.deezer.com/track/${track.id}`,
                run: () => addDeezerTrack(ctx, track),
              })
            }
          }

          log.info('import', 'starting import', {
            spotifyTracks: parsed.spotifyTrackIds.length,
            deezerTracks: parsed.deezerTrackIds.length,
            deezerPlaylists: parsed.deezerPlaylistIds.length,
            jobs: jobs.length,
            targetSuccess,
            maxAttempts,
          })

          // AI problems that would make every remaining new song fail the same way
          const STOP_CODES = new Set(['ai_not_connected', 'ai_rate_limited', 'ai_data_policy', 'ai_payment_required'])
          let stopError: HttpError | null = null

          const success: Track[] = []
          const skipped: Array<{ track: string; artist: string; reason: string }> = []
          const failed: Array<{ track: string; artist: string; reason: string; debug?: Record<string, unknown> }> = []

          // Sequential on purpose: keeps us inside LRCLIB, Deezer and OpenRouter's free-model rate limits,
          // and lets the client show tracks appearing one by one while it polls.
          const allowed = jobs.slice(0, maxAttempts)
          let attempted = 0
          let remaining: ImportJob[] = []
          for (const [index, job] of allowed.entries()) {
            if (success.length >= targetSuccess) break
            // Always try at least one song per request, so every chunk makes progress
            if (attempted > 0 && Date.now() - startedAt > TIME_BUDGET_MS) {
              remaining = allowed.slice(index)
              break
            }
            attempted++
            try {
              const result = await job.run()
              if (result.status === 'added') {
                success.push(result.track)
              } else {
                skipped.push({ track: result.track.title, artist: result.track.artist, reason: 'Already in collection' })
              }
            } catch (error) {
              const code = error instanceof HttpError ? error.body?.code : undefined
              if (typeof code === 'string' && STOP_CODES.has(code) && !stopError) {
                // Songs already in the catalog don't need AI, so keep going but only for those:
                // from now on, songs that need analysis fail right away instead of retrying the AI
                // (failed requests also count toward OpenRouter's free daily limit)
                const blocked = error as HttpError
                stopError = blocked
                ctx.getAiKey = () => Promise.reject(blocked)
              }
              if (!(error instanceof HttpError)) console.error(`Error importing ${job.label}:`, error)
              failed.push({
                track: job.label,
                artist: '',
                reason: error instanceof HttpError ? error.message : 'Could not analyze this track',
                ...(process.env.NODE_ENV !== 'production' && error instanceof HttpError && error.body ? { debug: error.body } : {}),
              })
            }
          }

          // If the AI stopped working, the next request would just hit the same error (and spend
          // another of the user's free daily requests), so don't hand anything back
          const remainingInput = stopError ? null : remaining.map((job) => job.link).join('\n') || null

          log.info('import', remainingInput ? 'import chunk finished' : 'import finished', {
            added: success.length,
            remaining: remainingInput ? remaining.length : 0,
            seconds: Math.round((Date.now() - startedAt) / 1000),
            skipped: skipped.length,
            failed: failed.length,
            failureReasons: failed.map((f) => f.debug?.reason ?? f.reason),
          })

          return json({
            totalProcessed: success.length + skipped.length + failed.length,
            successCount: success.length,
            skippedCount: skipped.length,
            failedCount: failed.length,
            tracks: success,
            skipped,
            failed,
            notice: stopError?.message ?? (parsed.spotifyPlaylistIds.length > 0 ? SPOTIFY_PLAYLIST_HELP : undefined),
            aiError: stopError?.body?.code,
            attempted,
            remaining: remainingInput,
          })
        } catch (error) {
          return errorResponse(error, 'Error importing tracks')
        }
      },
    },
  },
})
