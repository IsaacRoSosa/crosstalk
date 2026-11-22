import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { getSupabaseBrowserClient } from '../../lib/supabase/client'
import { mergePendingAnonymousAccount, signInToExistingGoogleAccount } from '../../lib/auth'

export const Route = createFileRoute('/auth/callback')({ component: AuthCallback })

type State =
  | { kind: 'working' }
  | { kind: 'already_linked' } // that Google account already has its own Crosstalk account
  | { kind: 'error'; message: string }

// Google (through Supabase) redirects here after "Save with Google"
function AuthCallback() {
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ kind: 'working' })
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    // Supabase reports failures in the query string or the hash
    const params = new URLSearchParams(window.location.search)
    const hashParams = new URLSearchParams(window.location.hash.slice(1))
    const errorCode = params.get('error_code') ?? hashParams.get('error_code')
    const errorDescription = params.get('error_description') ?? hashParams.get('error_description')

    if (errorCode === 'identity_already_exists') {
      setState({ kind: 'already_linked' })
      return
    }
    if (errorCode || params.get('error')) {
      setState({ kind: 'error', message: errorDescription ?? 'Google sign-in did not complete.' })
      return
    }

    // Creating the client finishes the sign-in: it exchanges the ?code= in the URL for a session
    getSupabaseBrowserClient()
      .auth.getSession()
      .then(async ({ data, error }) => {
        if (error || !data.session || data.session.user.is_anonymous) {
          throw new Error(error?.message ?? 'Google sign-in did not complete.')
        }
        await mergePendingAnonymousAccount()
        navigate({ to: '/app', replace: true })
      })
      .catch((err: unknown) => setState({ kind: 'error', message: err instanceof Error ? err.message : 'Google sign-in failed.' }))
  }, [navigate])

  const goHome = () => navigate({ to: '/app', replace: true })

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6 font-mono">
      <div className="max-w-sm w-full border border-white/30 p-6 text-sm">
        {state.kind === 'working' && <p>Signing in...</p>}

        {state.kind === 'already_linked' && (
          <>
            <p className="mb-3">That Google account already has a Crosstalk account.</p>
            <p className="mb-4 text-white/60">
              You can sign in to it and bring the songs from this session along. Your chat from this session won't be moved.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => signInToExistingGoogleAccount().catch(() => setState({ kind: 'error', message: 'Could not open Google sign-in.' }))}
                className="px-3 py-2 bg-white text-black hover:bg-gray-200 font-semibold"
              >
                Sign in and bring my songs
              </button>
              <button onClick={goHome} className="px-3 py-2 border border-white/30 hover:border-white">
                Keep using this session
              </button>
            </div>
          </>
        )}

        {state.kind === 'error' && (
          <>
            <p className="mb-4">{state.message}</p>
            <button onClick={goHome} className="px-3 py-2 bg-white text-black hover:bg-gray-200 font-semibold">
              Back to Crosstalk
            </button>
          </>
        )}
      </div>
    </div>
  )
}
