import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, json } from '../../../lib/http'
import { requireUser } from '../../../lib/session'
import { getAdminClient } from '../../../lib/supabase/server'
import { log } from '../../../lib/log'

export const Route = createFileRoute('/api/account/')({
  server: {
    handlers: {
      // Deletes the signed-in user. In the database this cascades to their profile, nuclei, the songs
      // listed in them, their chats and their encrypted OpenRouter key. Shared song readings stay.
      DELETE: async ({ request }) => {
        try {
          const ctx = await requireUser(request)
          const { error } = await getAdminClient().auth.admin.deleteUser(ctx.userId)
          if (error) throw error
          log.info('account', 'deleted account', { guest: ctx.isAnonymous })
          return json({ deleted: true })
        } catch (error) {
          return errorResponse(error, 'Error deleting account')
        }
      },
    },
  },
})
