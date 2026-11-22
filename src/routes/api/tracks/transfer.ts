import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, HttpError, json } from '../../../lib/http'
import { parseTrackIds, requireNucleus, requireUser } from '../../../lib/session'
import { addTracksToNucleus, countNucleusTracks, removeTracksFromNucleus } from '../../../lib/repository'
import { MAX_TRACKS_PER_NUCLEUS } from '../../../types/nucleus'

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

          // Songs already in the target don't take more room
          const { data: inTarget, error: targetError } = await user.db
            .from('nucleus_tracks')
            .select('track_id')
            .eq('nucleus_id', to.nucleus.id)
            .in('track_id', trackIds)
          if (targetError) throw targetError
          const newCount = trackIds.length - inTarget.length
          const room = MAX_TRACKS_PER_NUCLEUS - (await countNucleusTracks(user.db, to.nucleus.id))
          if (newCount > room) {
            throw new HttpError(
              422,
              room <= 0
                ? `${to.nucleus.name} is full (${MAX_TRACKS_PER_NUCLEUS} songs).`
                : `${to.nucleus.name} only has room for ${room} more song${room === 1 ? '' : 's'}.`,
              { code: 'nucleus_full' },
            )
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
