import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, HttpError, json } from '../../../lib/http'
import { requireEnv } from '../../../lib/env'
import { requireUser } from '../../../lib/session'
import { getCatalogTrack, getNucleusTrackAddedAt, setTrackVideo } from '../../../lib/repository'
import { getAdminClient } from '../../../lib/supabase/server'
import { searchYouTubeVideoId } from '../../../lib/youtube'

// Returns a YouTube video id to play a track in the user's nucleus.
// The result is cached in the catalog, so each song costs at most one YouTube search.
export const Route = createFileRoute('/api/tracks/video')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const ctx = await requireUser(request)
          const { trackId } = await request.json()
          if (!Number.isInteger(trackId)) {
            throw new HttpError(400, 'Invalid track id')
          }

          const inNucleus = await getNucleusTrackAddedAt(ctx.db, ctx.nucleus.id, trackId)
          const track = inNucleus ? await getCatalogTrack(ctx.db, trackId) : null
          if (!track) {
            throw new HttpError(404, 'Track not found')
          }

          if (track.youtube_video_id) {
            return json({ videoId: track.youtube_video_id })
          }

          const videoId = await searchYouTubeVideoId(
            `${track.title} ${track.artist} official audio`,
            requireEnv('YOUTUBE_API_KEY'),
          )
          if (videoId) {
            await setTrackVideo(getAdminClient(), track.id, videoId)
          }
          return json({ videoId })
        } catch (error) {
          return errorResponse(error, 'Error finding video')
        }
      },
    },
  },
})
