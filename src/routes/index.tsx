import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { NucleusVisualization } from '../components/NucleusVisualization'
import { ghostButtonClass, primaryButtonClass, PulseDot, Wordmark } from '../components/ui'
import { EXAMPLE_TRACKS } from '../data/example-nucleus'
import { getSupabaseBrowserClient } from '../lib/supabase/client'
import '../styles/galaxy.css'

export const Route = createFileRoute('/')({ component: Landing })

// Public landing page. It never creates a session by itself (visitors and crawlers don't become
// anonymous users): the session starts when someone begins their nucleus.
function Landing() {
  const [returning, setReturning] = useState(false)
  // Set by the profile page after deleting an account
  const [deleted, setDeleted] = useState(false)

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('deleted')) {
      setDeleted(true)
      window.history.replaceState(null, '', '/')
    }
    getSupabaseBrowserClient()
      .auth.getSession()
      .then(({ data }) => setReturning(Boolean(data.session)))
      .catch(() => setReturning(false))
  }, [])

  return (
    <div className="relative h-screen min-h-[560px] overflow-hidden bg-black text-white">
      {/* The example nucleus, turning slowly behind the copy */}
      <div className="absolute inset-y-0 left-0 right-0 md:left-[30%]">
        <NucleusVisualization tracks={EXAMPLE_TRACKS} />
      </div>
      <div className="ct-scanlines absolute inset-0" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(90deg, rgba(0,0,0,.97) 0%, rgba(0,0,0,.94) 40%, rgba(0,0,0,.45) 66%, rgba(0,0,0,0) 88%)',
        }}
      />

      {/* On narrow screens the galaxy sits behind the copy, so dim it more */}
      <div className="pointer-events-none absolute inset-0 bg-black/65 md:hidden" />

      <header className="absolute left-6 right-6 top-6 flex items-center justify-between gap-4 md:left-[72px]">
        <Wordmark />
        {deleted && (
          <p className="ct-fade-up border border-white/30 bg-black/80 px-3 py-2 text-[11px] text-white/80">
            your account and everything in it was deleted.
          </p>
        )}
      </header>

      <main className="pointer-events-none relative flex h-full max-w-[760px] flex-col justify-center px-6 md:px-[72px]">
        <div className="mb-7 flex items-center gap-2.5">
          <PulseDot />
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/55">
            {returning ? 'welcome back' : 'no account needed'}
          </div>
        </div>

        <h1 className="ct-fade-up mb-6 text-[34px] font-semibold leading-[1.12] tracking-tight md:text-[52px]">
          how much of you
          <br />
          is in your library?
        </h1>

        <p className="mb-10 max-w-[440px] text-[13px] leading-[1.9] text-white/60">
          crosstalk reads the lyrics of the songs you keep coming back to and builds a nucleus. a first impression of you,
          before anyone says a word.
        </p>

        <div className="pointer-events-auto flex flex-wrap gap-3">
          {returning ? (
            <Link to="/app" className={primaryButtonClass}>
              open your nucleus
            </Link>
          ) : (
            <Link to="/start" className={primaryButtonClass}>
              start your nucleus
            </Link>
          )}
          <Link to="/example" className={ghostButtonClass}>
            see an example nucleus
          </Link>
        </div>
      </main>

      <footer className="absolute bottom-10 left-6 flex flex-wrap gap-x-8 gap-y-2 text-[9px] uppercase tracking-[0.12em] text-white/30 md:left-[72px]">
        <span>4 orbits</span>
        <span>lyric analysis</span>
        <span>free ai models</span>
        <span>no feed. no likes.</span>
        <Link to="/privacy" className="pointer-events-auto text-white/45 underline hover:text-white">
          privacy: we never sell your data
        </Link>
      </footer>
    </div>
  )
}
