import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, HttpError, json } from '../../../../lib/http'
import { requireUser } from '../../../../lib/session'
import { exchangeOpenRouterCode } from '../../../../lib/ai/openrouter'
import { getAiConnectionStatus, saveOpenRouterKey } from '../../../../lib/ai/connection'
import { log } from '../../../../lib/log'

// Last step of "Connect OpenRouter": the browser sends the one-time code and its PKCE verifier,
// the server exchanges them for the user's key and stores it encrypted. The key never reaches
// browser JavaScript.
export const Route = createFileRoute('/api/ai/openrouter/exchange')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const ctx = await requireUser(request)
          const { code, codeVerifier } = await request.json()
          if (typeof code !== 'string' || !code || typeof codeVerifier !== 'string' || codeVerifier.length < 43) {
            throw new HttpError(400, 'Invalid OpenRouter response. Please try connecting again.')
          }

          const apiKey = await exchangeOpenRouterCode(code, codeVerifier)
          await saveOpenRouterKey(ctx.userId, apiKey)
          log.info('openrouter', 'connected', { userId: ctx.userId })

          return json(await getAiConnectionStatus(ctx.userId))
        } catch (error) {
          return errorResponse(error, 'Error connecting OpenRouter')
        }
      },
    },
  },
})
