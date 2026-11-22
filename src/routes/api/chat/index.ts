import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, json } from '../../../lib/http'
import { requireUser } from '../../../lib/session'
import { clearMessages, listMessages } from '../../../lib/repository'

export const Route = createFileRoute('/api/chat/')({
  server: {
    handlers: {
      // The user's nucleus and its conversation
      GET: async ({ request }) => {
        try {
          const ctx = await requireUser(request)
          const messages = await listMessages(ctx.db, ctx.nucleus.id)
          const { id, name, dominant_emotion, updated_at } = ctx.nucleus
          return json({ messages, nucleus: { id, name, dominant_emotion, updated_at } })
        } catch (error) {
          return errorResponse(error, 'Error fetching chat messages')
        }
      },

      DELETE: async ({ request }) => {
        try {
          const ctx = await requireUser(request)
          await clearMessages(ctx.db, ctx.nucleus.id)
          return json({ success: true })
        } catch (error) {
          return errorResponse(error, 'Error clearing chat messages')
        }
      },
    },
  },
})
