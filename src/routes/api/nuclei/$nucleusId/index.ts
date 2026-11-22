import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, HttpError, json } from '../../../../lib/http'
import { requireNucleus, requireUser } from '../../../../lib/session'
import { deleteNucleus, updateNucleus } from '../../../../lib/repository'

export const Route = createFileRoute('/api/nuclei/$nucleusId/')({
  server: {
    handlers: {
      // One nucleus (name and dominant emotion)
      GET: async ({ request, params }) => {
        try {
          const { nucleus } = await requireNucleus(await requireUser(request), params.nucleusId)
          const { id, name, dominant_emotion, created_at, updated_at, impression, impression_track_count, impression_updated_at } = nucleus
          return json({
            nucleus: { id, name, dominant_emotion, created_at, updated_at, impression, impression_track_count, impression_updated_at },
          })
        } catch (error) {
          return errorResponse(error, 'Error loading nucleus')
        }
      },

      // Renames a nucleus by hand
      PATCH: async ({ request, params }) => {
        try {
          const ctx = await requireNucleus(await requireUser(request), params.nucleusId)
          const body = await request.json().catch(() => ({}))
          const name = typeof body.name === 'string' ? body.name.trim() : ''
          if (!name || name.length > 80) {
            throw new HttpError(400, 'Names can be 1 to 80 characters long.')
          }
          // From now on the AI's reads keep this name
          const updated = await updateNucleus(ctx.db, ctx.nucleus.id, { name, name_is_custom: true })
          return json({ nucleus: { id: updated.id, name: updated.name } })
        } catch (error) {
          return errorResponse(error, 'Error renaming nucleus')
        }
      },

      // Deletes a nucleus with its song list and chat. The songs stay in the shared catalog
      // (and in any other nucleus that has them).
      DELETE: async ({ request, params }) => {
        try {
          const ctx = await requireNucleus(await requireUser(request), params.nucleusId)
          const { count, error } = await ctx.db.from('nuclei').select('id', { count: 'exact', head: true })
          if (error) throw error
          if ((count ?? 0) <= 1) {
            throw new HttpError(400, "This is your only nucleus, so it can't be deleted. Remove its songs instead.", {
              code: 'last_nucleus',
            })
          }
          await deleteNucleus(ctx.db, ctx.nucleus.id)
          return json({ success: true })
        } catch (error) {
          return errorResponse(error, 'Error deleting nucleus')
        }
      },
    },
  },
})
