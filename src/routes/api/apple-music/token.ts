import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, HttpError, json } from '../../../lib/http'
import { createDeveloperToken, isAppleMusicConfigured } from '../../../lib/apple-music'
import { log } from '../../../lib/log'

// The developer token MusicKit JS needs in the browser to let someone connect Apple Music. It's
// public by design (Apple expects it in web pages) and short-lived; the private key stays here.
// 503 when Apple Music isn't set up, so the page hides the connect button.
export const Route = createFileRoute('/api/apple-music/token')({
  server: {
    handlers: {
      GET: async () => {
        try {
          if (!isAppleMusicConfigured()) {
            log.warn('apple-music', 'not configured', {
              teamId: Boolean(process.env.APPLE_MUSIC_TEAM_ID),
              keyId: Boolean(process.env.APPLE_MUSIC_KEY_ID),
              privateKey: Boolean(process.env.APPLE_MUSIC_PRIVATE_KEY),
            })
            throw new HttpError(503, 'Apple Music is not set up.', { code: 'apple_music_unavailable' })
          }
          let token: string
          try {
            token = createDeveloperToken()
          } catch (error) {
            // Usually the private key: missing BEGIN/END lines, or line breaks lost on the way into .env
            log.error('apple-music', 'could not sign developer token', {
              error: error instanceof Error ? error.message : String(error),
              keyHasBeginLine: (process.env.APPLE_MUSIC_PRIVATE_KEY ?? '').trim().startsWith('-----BEGIN PRIVATE KEY-----'),
              keyHasLineBreaks: /\n|\\n/.test(process.env.APPLE_MUSIC_PRIVATE_KEY ?? ''),
            })
            throw new HttpError(500, 'Apple Music is set up wrong (developer token).', { code: 'apple_music_bad_key' })
          }
          log.info('apple-music', 'developer token issued')
          const response = json({ token })
          response.headers.set('Cache-Control', 'private, max-age=3600')
          return response
        } catch (error) {
          return errorResponse(error, 'Error creating Apple Music token')
        }
      },
    },
  },
})
