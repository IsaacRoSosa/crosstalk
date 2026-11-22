import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, json } from '../../../lib/http'
import { parseTrackIds, requireNucleus, requireUser } from '../../../lib/session'
import { listNucleusTracks, removeTracksFromNucleus } from '../../../lib/repository'

export const Route = createFileRoute('/api/tracks/')({
  server: {
    handlers: {
      // Tracks in a nucleus, newest first: GET /api/tracks?nucleus=<id>
      GET: async ({ request }) => {
        try {
          const nucleusId = new URL(request.url).searchParams.get('nucleus')
          const ctx = await requireNucleus(await requireUser(request), nucleusId)
          const tracks = await listNucleusTracks(ctx.db, ctx.nucleus.id)
          return json({ tracks })
        } catch (error) {
          return errorResponse(error, 'Error fetching tracks')
        }
      },

      // Removes tracks from a nucleus: { nucleusId, trackIds } (the shared catalog entries stay)
      DELETE: async ({ request }) => {
        try {
          const body = await request.json()
          const ctx = await requireNucleus(await requireUser(request), body.nucleusId)
          const removed = await removeTracksFromNucleus(ctx.db, ctx.nucleus.id, parseTrackIds(body.trackIds))
          return json({ removed })
        } catch (error) {
          return errorResponse(error, 'Error removing tracks')
        }
      },
    },
  },
})
