import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, json } from '../../../lib/http'
import { requireUser } from '../../../lib/session'
import { deleteAiConnection, getAiConnectionStatus } from '../../../lib/ai/connection'

export const Route = createFileRoute('/api/ai/connection')({
  server: {
    handlers: {
      // Whether the user has connected their AI (never returns the key itself)
      GET: async ({ request }) => {
        try {
          const ctx = await requireUser(request)
          return json(await getAiConnectionStatus(ctx.userId))
        } catch (error) {
          return errorResponse(error, 'Error reading AI connection')
        }
      },

      // Forgets the user's key. They can also revoke it from their OpenRouter account.
      DELETE: async ({ request }) => {
        try {
          const ctx = await requireUser(request)
          await deleteAiConnection(ctx.userId)
          return json({ connected: false })
        } catch (error) {
          return errorResponse(error, 'Error disconnecting AI')
        }
      },
    },
  },
})
