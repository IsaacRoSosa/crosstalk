import { createFileRoute } from '@tanstack/react-router'
import { generateNucleusName } from '../../../lib/ai/analysis'
import { errorResponse, HttpError, json } from '../../../lib/http'
import { requireUser } from '../../../lib/session'
import { listNucleusTracks, updateNucleus } from '../../../lib/repository'

export const Route = createFileRoute('/api/nucleus/rename')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const ctx = await requireUser(request)

          const apiKey = await ctx.getAiKey()

          const tracks = await listNucleusTracks(ctx.db, ctx.nucleus.id)
          if (tracks.length === 0) {
            throw new HttpError(400, 'No tracks to analyze')
          }

          const emotionCounts: Record<string, number> = {}
          const genres = new Set<string>()
          const moodDescriptions: string[] = []

          for (const track of tracks) {
            emotionCounts[track.emotion] = (emotionCounts[track.emotion] || 0) + 1
            if (track.genre) genres.add(track.genre)
            if (track.mood_description) moodDescriptions.push(track.mood_description)
          }

          const topEmotions = Object.entries(emotionCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([emotion]) => emotion)

          const generatedName = await generateNucleusName(ctx.userId, apiKey, {
            trackCount: tracks.length,
            topEmotions,
            genres: Array.from(genres).slice(0, 5),
            moodDescriptions: moodDescriptions.slice(0, 5),
          })
          const name = generatedName.trim().slice(0, 80) || ctx.nucleus.name
          const dominantEmotion = topEmotions[0] ?? null

          await updateNucleus(ctx.db, ctx.nucleus.id, { name, dominant_emotion: dominantEmotion })

          return json({ name, dominantEmotion })
        } catch (error) {
          return errorResponse(error, 'Error renaming nucleus')
        }
      },
    },
  },
})
