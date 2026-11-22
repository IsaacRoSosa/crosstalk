import { createFileRoute } from '@tanstack/react-router'
import { readNucleus } from '../../../../lib/ai/analysis'
import { errorResponse, HttpError, json } from '../../../../lib/http'
import { requireNucleus, requireUser } from '../../../../lib/session'
import { listNucleusTracks } from '../../../../lib/repository'
import { describeNucleusFacts, describeSongs } from '../../../../lib/nucleus-facts'

// Reads a nucleus as a whole: a first impression of the person, and a name for the collection.
// One AI request for both. A name the user typed stays.
export const Route = createFileRoute('/api/nuclei/$nucleusId/read')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const ctx = await requireNucleus(await requireUser(request), params.nucleusId)
          const apiKey = await ctx.getAiKey()

          const tracks = await listNucleusTracks(ctx.db, ctx.nucleus.id)
          if (tracks.length === 0) {
            throw new HttpError(400, 'Add some songs first.')
          }

          const read = await readNucleus(ctx.userId, apiKey, describeNucleusFacts(tracks), describeSongs(tracks))

          const emotionCounts = new Map<string, number>()
          for (const t of tracks) emotionCounts.set(t.emotion, (emotionCounts.get(t.emotion) ?? 0) + 1)
          const dominantEmotion = [...emotionCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

          const name = ctx.nucleus.name_is_custom ? ctx.nucleus.name : read.name.slice(0, 80) || ctx.nucleus.name
          const impressionUpdatedAt = new Date().toISOString()
          const { error } = await ctx.db
            .from('nuclei')
            .update({
              name,
              dominant_emotion: dominantEmotion,
              impression: read.impression,
              impression_track_count: tracks.length,
              impression_updated_at: impressionUpdatedAt,
            })
            .eq('id', ctx.nucleus.id)
          if (error) throw error

          return json({
            name,
            impression: read.impression,
            impressionTrackCount: tracks.length,
            impressionUpdatedAt,
            dominantEmotion,
          })
        } catch (error) {
          return errorResponse(error, 'Error reading nucleus')
        }
      },
    },
  },
})
