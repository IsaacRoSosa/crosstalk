import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, HttpError, json } from '../../../lib/http'
import { requireUser } from '../../../lib/session'
import { listNucleusTracks, removeTrackFromNucleus } from '../../../lib/repository'

export const Route = createFileRoute('/api/tracks/')({
  server: {
    handlers: {
      // Tracks in the user's nucleus, newest first
      GET: async ({ request }) => {
        try {
          const ctx = await requireUser(request)
          const tracks = await listNucleusTracks(ctx.db, ctx.nucleus.id)
          return json({ tracks })
        } catch (error) {
          return errorResponse(error, 'Error fetching tracks')
        }
      },

      // Removes a track from the user's nucleus (the shared catalog entry stays)
      DELETE: async ({ request }) => {
        try {
          const ctx = await requireUser(request)
          const { id } = await request.json()
          if (!Number.isInteger(id)) {
            throw new HttpError(400, 'Invalid track id')
          }
          await removeTrackFromNucleus(ctx.db, ctx.nucleus.id, id)
          return json({ success: true })
        } catch (error) {
          return errorResponse(error, 'Error removing track')
        }
      },
    },
  },
})
