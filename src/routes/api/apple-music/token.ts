import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, HttpError, json } from '../../../lib/http'
import { createDeveloperToken, isAppleMusicConfigured } from '../../../lib/apple-music'

// The developer token MusicKit JS needs in the browser to let someone connect Apple Music. It's
// public by design (Apple expects it in web pages) and short-lived; the private key stays here.
// 503 when Apple Music isn't set up, so the page hides the connect button.
export const Route = createFileRoute('/api/apple-music/token')({
  server: {
    handlers: {
      GET: async () => {
        try {
          if (!isAppleMusicConfigured()) {
            throw new HttpError(503, 'Apple Music is not set up.', { code: 'apple_music_unavailable' })
          }
          const response = json({ token: createDeveloperToken() })
          response.headers.set('Cache-Control', 'private, max-age=3600')
          return response
        } catch (error) {
          return errorResponse(error, 'Error creating Apple Music token')
        }
      },
    },
  },
})
