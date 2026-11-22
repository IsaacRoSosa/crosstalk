import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, json } from '../../../lib/http'
import { requireNucleus, requireUser } from '../../../lib/session'
import { clearMessages, listMessages } from '../../../lib/repository'

export const Route = createFileRoute('/api/chat/')({
  server: {
    handlers: {
      // A nucleus and its conversation: GET /api/chat?nucleus=<id>
      GET: async ({ request }) => {
        try {
          const nucleusId = new URL(request.url).searchParams.get('nucleus')
          const ctx = await requireNucleus(await requireUser(request), nucleusId)
          const messages = await listMessages(ctx.db, ctx.nucleus.id)
          const { id, name, dominant_emotion, updated_at } = ctx.nucleus
          return json({ messages, nucleus: { id, name, dominant_emotion, updated_at } })
        } catch (error) {
          return errorResponse(error, 'Error fetching chat messages')
        }
      },

      DELETE: async ({ request }) => {
        try {
          const body = await request.json().catch(() => ({}))
          const ctx = await requireNucleus(await requireUser(request), body.nucleusId)
          await clearMessages(ctx.db, ctx.nucleus.id)
          return json({ success: true })
        } catch (error) {
          return errorResponse(error, 'Error clearing chat messages')
        }
      },
    },
  },
})
