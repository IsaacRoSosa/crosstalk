import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { completeOpenRouterConnect } from '../../lib/openrouter-connect'

export const Route = createFileRoute('/ai/callback')({ component: OpenRouterCallback })

type State = { kind: 'working' } | { kind: 'handed_off' } | { kind: 'error'; message: string }

// OpenRouter sends people here after they approve (or cancel) the connection, usually in the tab
// that Crosstalk opened for it
function OpenRouterCallback() {
  const [state, setState] = useState<State>({ kind: 'working' })
  const started = useRef(false)

  useEffect(() => {
    // React dev mode runs effects twice; the code can only be exchanged once
    if (started.current) return
    started.current = true

    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    if (!code) {
      setState({ kind: 'error', message: 'OpenRouter did not connect. Go back to Crosstalk and try again.' })
      return
    }

    completeOpenRouterConnect(code, params.get('state'))
      .then(({ handedOff, returnTo }) => {
        if (handedOff) {
          // The Crosstalk tab that started this continues on its own
          setState({ kind: 'handed_off' })
          window.close()
        } else {
          // returnTo is a same-site path that may carry a query (e.g. /start?step=forming)
          window.location.replace(returnTo)
        }
      })
      .catch((err: unknown) =>
        setState({ kind: 'error', message: err instanceof Error ? err.message : 'Could not connect OpenRouter.' }),
      )
  }, [])

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6 font-mono">
      <div className="max-w-sm w-full border border-white/30 p-6 text-sm">
        {state.kind === 'working' && <p>Connecting OpenRouter...</p>}
        {state.kind === 'handed_off' && (
          <p>OpenRouter is connected. You can close this tab and go back to Crosstalk.</p>
        )}
        {state.kind === 'error' && (
          <>
            <p className="mb-4">{state.message}</p>
            <a href="/app" className="inline-block px-3 py-2 bg-white text-black hover:bg-gray-200 hover:text-black font-semibold">
              Back to Crosstalk
            </a>
          </>
        )}
      </div>
    </div>
  )
}
