import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { NucleusVisualization } from '../components/NucleusVisualization'
import { Eyebrow, primaryButtonClass, Wordmark } from '../components/ui'
import { EXAMPLE_NUCLEUS_NAME, EXAMPLE_TRACKS } from '../data/example-nucleus'
import type { Track } from '../types/track'
import '../styles/galaxy.css'

export const Route = createFileRoute('/example')({
  component: ExampleNucleus,
  head: () => ({ meta: [{ title: `${EXAMPLE_NUCLEUS_NAME} · an example nucleus · Crosstalk` }] }),
})

// A read-only nucleus built from pre-analyzed songs, to show what Crosstalk makes
function ExampleNucleus() {
  const [selected, setSelected] = useState<Track | null>(null)

  return (
    <div className="fixed inset-0 bg-black text-white">
      <div className="absolute inset-0">
        <NucleusVisualization tracks={EXAMPLE_TRACKS} onTrackClick={setSelected} onOrbitClick={() => setSelected(null)} />
      </div>
      <div className="ct-scanlines absolute inset-0" />

      <header className="absolute left-6 right-6 top-6 flex items-start justify-between gap-4 pointer-events-none">
        <div className="pointer-events-auto">
          <Wordmark />
        </div>
        <div className="pointer-events-auto">
          <Link to="/start" className={primaryButtonClass}>
            start your own →
          </Link>
        </div>
      </header>

      <div className="absolute left-6 top-20 max-w-xs pointer-events-none">
        <Eyebrow>example nucleus</Eyebrow>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{EXAMPLE_NUCLEUS_NAME.toLowerCase()}</h1>
        <p className="mt-2 text-[11px] leading-relaxed text-white/50">
          {EXAMPLE_TRACKS.length} songs · each one read for mood from its lyrics, then placed in orbit. drag to turn it, click a
          song to see what crosstalk heard.
        </p>
      </div>

      {selected && (
        <div className="ct-fade-up absolute bottom-6 left-6 w-[min(360px,calc(100%-3rem))] border border-white/25 bg-black/90 p-4">
          <div className="flex items-start gap-3">
            {selected.cover_url && <img src={selected.cover_url} alt="" className="h-14 w-14 shrink-0 object-cover" />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{selected.title}</div>
              <div className="truncate text-xs text-white/60">{selected.artist}</div>
              <div className="mt-1 text-[10px] uppercase tracking-[0.15em] text-white/40">
                {selected.emotion} · {selected.genre}
              </div>
            </div>
            <button onClick={() => setSelected(null)} className="text-white/40 hover:text-white" aria-label="Close">
              ×
            </button>
          </div>
          {selected.mood_description && <p className="mt-3 text-[11px] leading-relaxed text-white/70">{selected.mood_description}</p>}
        </div>
      )}
    </div>
  )
}
