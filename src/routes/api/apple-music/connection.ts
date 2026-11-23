import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, HttpError, json } from '../../../lib/http'
import { requireUser } from '../../../lib/session'
import { isAppleMusicConfigured } from '../../../lib/apple-music'
import {
  deleteAppleMusicConnection,
  getAppleMusicConnectionStatus,
  saveAppleMusicToken,
} from '../../../lib/apple-music-connection'

// A Google account's saved Apple Music connection (never returns the token itself)
export const Route = createFileRoute('/api/apple-music/connection')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const ctx = await requireUser(request)
          return json(ctx.isAnonymous ? { saved: false } : await getAppleMusicConnectionStatus(ctx.userId))
        } catch (error) {
          return errorResponse(error, 'Error reading Apple Music connection')
        }
      },

      // Saves the Music User Token MusicKit gave the browser. Guests' tokens aren't saved.
      POST: async ({ request }) => {
        try {
          const ctx = await requireUser(request)
          if (!isAppleMusicConfigured()) throw new HttpError(503, 'Apple Music is not set up.')
          const body = await request.json().catch(() => ({}))
          const userToken = typeof body.userToken === 'string' ? body.userToken.trim() : ''
          const storefront = typeof body.storefront === 'string' && /^[a-z]{2}$/.test(body.storefront) ? body.storefront : null
          if (!userToken || userToken.length > 4000) throw new HttpError(400, 'Missing Apple Music token.')
          if (ctx.isAnonymous) return json({ saved: false })
          await saveAppleMusicToken(ctx.userId, userToken, storefront)
          return json({ saved: true })
        } catch (error) {
          return errorResponse(error, 'Error saving Apple Music connection')
        }
      },

      // Forgets the token. The person can also remove Crosstalk from their Apple account.
      DELETE: async ({ request }) => {
        try {
          const ctx = await requireUser(request)
          await deleteAppleMusicConnection(ctx.userId)
          return json({ saved: false })
        } catch (error) {
          return errorResponse(error, 'Error disconnecting Apple Music')
        }
      },
    },
  },
})
