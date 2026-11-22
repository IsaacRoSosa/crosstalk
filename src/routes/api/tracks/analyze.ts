import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, HttpError, json } from '../../../lib/http'
import { requireUser } from '../../../lib/session'
import { extractSpotifyTrackId } from '../../../lib/spotify'
import { addSpotifyTrack } from '../../../lib/track-pipeline'

export const Route = createFileRoute('/api/tracks/analyze')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const ctx = await requireUser(request)
          const { spotifyUrl } = await request.json()

          const trackId = typeof spotifyUrl === 'string' ? extractSpotifyTrackId(spotifyUrl) : null
          if (!trackId) {
            throw new HttpError(400, 'Invalid Spotify URL')
          }

          const result = await addSpotifyTrack(ctx, trackId)
          if (result.status === 'already_in_nucleus') {
            return json({ error: 'Track already exists', track: result.track }, 409)
          }
          return json({ track: result.track }, 201)
        } catch (error) {
          return errorResponse(error, 'Error analyzing track')
        }
      },
    },
  },
})
