import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, HttpError, json } from '../../../lib/http'
import { parseTrackIds, requireNucleus, requireUser } from '../../../lib/session'
import { addTracksToNucleus, removeTracksFromNucleus } from '../../../lib/repository'

// Copies or moves songs from one of the user's nuclei to another:
// { fromNucleusId, toNucleusId, trackIds, mode: 'copy' | 'move' }.
// Songs are already analysed, so this never calls the AI.
export const Route = createFileRoute('/api/tracks/transfer')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json()
          const user = await requireUser(request)
          const from = await requireNucleus(user, body.fromNucleusId)
          const to = await requireNucleus(user, body.toNucleusId)
          if (from.nucleus.id === to.nucleus.id) {
            throw new HttpError(400, 'Pick a different nucleus.')
          }
          const mode = body.mode === 'move' ? 'move' : 'copy'
          const requested = parseTrackIds(body.trackIds)

          // Only songs that really are in the source nucleus (RLS already limits this to the user's own)
          const { data: present, error } = await user.db
            .from('nucleus_tracks')
            .select('track_id')
            .eq('nucleus_id', from.nucleus.id)
            .in('track_id', requested)
          if (error) throw error
          const trackIds = present.map((row) => row.track_id)
          if (trackIds.length === 0) {
            throw new HttpError(404, 'Those songs are no longer in this nucleus.')
          }

          const added = await addTracksToNucleus(user.db, to.nucleus.id, trackIds)
          const removed = mode === 'move' ? await removeTracksFromNucleus(user.db, from.nucleus.id, trackIds) : 0

          return json({ mode, added, alreadyThere: trackIds.length - added, removed })
        } catch (error) {
          return errorResponse(error, 'Error moving tracks')
        }
      },
    },
  },
})
