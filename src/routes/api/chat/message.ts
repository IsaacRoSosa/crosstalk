import { createFileRoute } from '@tanstack/react-router'
import { chatReply } from '../../../lib/ai/analysis'
import { errorResponse, HttpError, json } from '../../../lib/http'
import { requireNucleus, requireUser } from '../../../lib/session'
import { addMessages, listMessages, listNucleusTracks } from '../../../lib/repository'
import type { Track } from '../../../types/track'
import { describeNucleusFacts, describeSongs } from '../../../lib/nucleus-facts'

const MAX_MESSAGE_LENGTH = 2000
const HISTORY_LENGTH = 10

function describeCollection(nucleusName: string, tracks: Track[], impression: string | null): string {
  if (tracks.length === 0) {
    return `You are someone who can read people through their music. The playlist "${nucleusName}" is still empty: the person hasn't added any tracks yet.`
  }

  return `You are someone who can read people through their music. You know the playlist "${nucleusName}" and what it says about the person who made it.

What their songs show:
${describeNucleusFacts(tracks)}
${impression ? `\nYour first impression of them, which they've seen:\n${impression}\n` : ''}
Their songs:
${describeSongs(tracks, 30)}`
}

const HOW_TO_TALK = `How to talk:
- Have a conversation. Respond to what they actually say first.
- If they say "hi", say hi back. Don't dump analysis.
- Keep it SHORT. 1-2 sentences usually. 3 max if you have something real to say.
- Lowercase, direct, casual but perceptive
- Periods only, no exclamation marks
- Drop an observation sometimes, not every message
- Ground it in their actual tracks when you do
- Ask questions occasionally, not constantly
- Never use markdown formatting. No asterisks, no bold, no italics. Just plain text.

Examples:
- "hey. yeah i know this collection pretty well."
- "interesting you picked that one. most people skip the low energy tracks."
- "you have basically no calm in here. just noticed that."
- "fair. that track does hit different."

You are not a therapist. You are just someone who notices patterns in music and what they might mean. Talk like a person.`

export const Route = createFileRoute('/api/chat/message')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json()
          const ctx = await requireNucleus(await requireUser(request), body.nucleusId)
          const message = typeof body.message === 'string' ? body.message.trim() : ''
          if (!message) {
            throw new HttpError(400, 'Message is required')
          }
          if (message.length > MAX_MESSAGE_LENGTH) {
            throw new HttpError(400, `Messages can be up to ${MAX_MESSAGE_LENGTH} characters`)
          }

          const apiKey = await ctx.getAiKey()

          const [tracks, history] = await Promise.all([
            listNucleusTracks(ctx.db, ctx.nucleus.id),
            listMessages(ctx.db, ctx.nucleus.id, HISTORY_LENGTH),
          ])

          const systemPrompt = `${describeCollection(ctx.nucleus.name, tracks, ctx.nucleus.impression)}\n\n${HOW_TO_TALK}`

          const response = await chatReply(ctx.userId, apiKey, systemPrompt, history, message)

          const reply = response.trim().slice(0, 8000) || '...'
          await addMessages(ctx.db, ctx.nucleus.id, [
            { role: 'user', content: message },
            { role: 'assistant', content: reply },
          ])

          return json({ response: reply })
        } catch (error) {
          return errorResponse(error, 'Error processing chat message')
        }
      },
    },
  },
})
