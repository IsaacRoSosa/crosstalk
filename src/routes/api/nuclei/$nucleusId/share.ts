import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, json } from '../../../../lib/http'
import { requireNucleus, requireUser } from '../../../../lib/session'
import { disableSharing, enableSharing } from '../../../../lib/share'

// The owner's controls for a nucleus's public link (/s/<token>)
export const Route = createFileRoute('/api/nuclei/$nucleusId/share')({
  server: {
    handlers: {
      // Whether the nucleus is shared, and its token if so
      GET: async ({ request, params }) => {
        try {
          const { nucleus } = await requireNucleus(await requireUser(request), params.nucleusId)
          return json({ token: nucleus.share_token })
        } catch (error) {
          return errorResponse(error, 'Error loading share link')
        }
      },

      // Turns sharing on (or returns the existing link)
      POST: async ({ request, params }) => {
        try {
          const ctx = await requireNucleus(await requireUser(request), params.nucleusId)
          const token = await enableSharing(ctx.db, ctx.nucleus.id, ctx.nucleus.share_token)
          return json({ token })
        } catch (error) {
          return errorResponse(error, 'Error sharing nucleus')
        }
      },

      // Turns sharing off: the link stops working
      DELETE: async ({ request, params }) => {
        try {
          const ctx = await requireNucleus(await requireUser(request), params.nucleusId)
          await disableSharing(ctx.db, ctx.nucleus.id)
          return json({ token: null })
        } catch (error) {
          return errorResponse(error, 'Error turning off share link')
        }
      },
    },
  },
})
