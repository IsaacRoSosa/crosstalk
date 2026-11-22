import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { completeOpenRouterConnect } from '../../lib/openrouter-connect'

export const Route = createFileRoute('/ai/callback')({ component: OpenRouterCallback })

// OpenRouter redirects here after the user approves (or cancels) the connection
function OpenRouterCallback() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    // React dev mode runs effects twice; the code can only be exchanged once
    if (started.current) return
    started.current = true

    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    if (!code) {
      setError('OpenRouter did not connect. You can try again from the sidebar.')
      return
    }

    completeOpenRouterConnect(code, params.get('state'))
      // returnTo is a same-site path that may carry a query (e.g. /start?step=forming)
      .then((returnTo) => window.location.replace(returnTo))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not connect OpenRouter.'))
  }, [navigate])

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6 font-mono">
      <div className="max-w-sm w-full border border-white/30 p-6 text-sm">
        {error ? (
          <>
            <p className="mb-4">{error}</p>
            <button
              onClick={() => navigate({ to: '/app', replace: true })}
              className="px-3 py-2 bg-white text-black hover:bg-gray-200 font-semibold"
            >
              Back to Crosstalk
            </button>
          </>
        ) : (
          <p>Connecting OpenRouter...</p>
        )}
      </div>
    </div>
  )
}
