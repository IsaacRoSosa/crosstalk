import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { NucleusVisualization } from '../../components/NucleusVisualization'
import { Eyebrow, ghostButtonClass, primaryButtonClass, Wordmark } from '../../components/ui'
import { loadSharedNucleus } from '../../lib/share'
import type { Track } from '../../types/track'
import '../../styles/galaxy.css'

// Read on the server (during SSR too, so link previews get the nucleus's name)
const fetchSharedNucleus = createServerFn({ method: 'GET' })
  .validator((token: string) => token)
  .handler(({ data: token }) => loadSharedNucleus(token))

export const Route = createFileRoute('/s/$token')({
  loader: ({ params }) => fetchSharedNucleus({ data: params.token }),
  head: ({ loaderData }) => {
    const title = loaderData ? `${loaderData.name} · a nucleus on Crosstalk` : 'Crosstalk · this link is off'
    const description = loaderData
      ? `${loaderData.tracks.length} songs, each one read from its lyrics, and a first impression of whoever keeps them on repeat.`
      : 'This shared nucleus is no longer available.'
    return {
      meta: [
        { title },
        { name: 'description', content: description },
        // Shared on purpose, but not meant to show up in search results
        { name: 'robots', content: 'noindex, nofollow' },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description },
      ],
    }
  },
  component: SharedNucleusPage,
})

function SharedNucleusPage() {
  const shared = Route.useLoaderData()
  const [selected, setSelected] = useState<Track | null>(null)
  const [impressionOpen, setImpressionOpen] = useState(true)

  if (!shared) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-black p-6 text-center font-mono text-white">
        <Wordmark />
        <div>
          <Eyebrow>link off</Eyebrow>
          <p className="mt-3 max-w-sm text-sm text-white/70">
            This nucleus isn't shared anymore, or the link is wrong. Ask whoever sent it for a new one.
          </p>
        </div>
        <Link to="/start" className={primaryButtonClass}>
          make your own →
        </Link>
      </div>
    )
  }

  const { name, impression, tracks } = shared

  return (
    <div className="fixed inset-0 bg-black font-mono text-white">
      <div className="absolute inset-0">
        <NucleusVisualization tracks={tracks} onTrackClick={setSelected} onOrbitClick={() => setSelected(null)} />
      </div>
      <div className="ct-scanlines pointer-events-none absolute inset-0" />

      <header className="pointer-events-none absolute left-6 right-6 top-6 flex items-start justify-between gap-4">
        <div className="pointer-events-auto">
          <Wordmark />
        </div>
        <div className="pointer-events-auto">
          <Link to="/start" className={primaryButtonClass}>
            make your own →
          </Link>
        </div>
      </header>

      {!selected && (
        <div className="absolute left-6 top-20 w-[min(380px,calc(100%-3rem))]">
          <Eyebrow>a shared nucleus</Eyebrow>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">{name.toLowerCase()}</h1>
          <p className="mt-2 text-[11px] leading-relaxed text-white/50">
            {tracks.length} songs · each one read for mood from its lyrics, then placed in orbit. drag to turn it, click a song
            to see what crosstalk heard.
          </p>

          {impression && (
            <div className="mt-4 border border-white/25 bg-black/85">
              <button
                onClick={() => setImpressionOpen(!impressionOpen)}
                className="flex w-full items-center px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-white/50 hover:text-white"
                aria-expanded={impressionOpen}
              >
                first impression
                {impressionOpen ? <ChevronUp className="ml-auto h-3.5 w-3.5" /> : <ChevronDown className="ml-auto h-3.5 w-3.5" />}
              </button>
              {impressionOpen && (
                <p className="max-h-[40vh] overflow-y-auto border-t border-white/10 px-3 pb-3 pt-2.5 text-[12px] leading-relaxed text-white/85">
                  {impression}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {selected && <SongCard track={selected} onClose={() => setSelected(null)} />}

      {!selected && (
        <div className="absolute bottom-6 right-6 hidden sm:block">
          <Link to="/start" className={ghostButtonClass}>
            what would yours say? →
          </Link>
        </div>
      )}
    </div>
  )
}

function SongCard({ track, onClose }: { track: Track; onClose: () => void }) {
  const details = [track.emotion, track.secondary_emotion, track.genre].filter(Boolean).join(' · ')
  const about = [track.addressee && `sung to: ${track.addressee}`, track.stance].filter(Boolean).join(' · ')

  return (
    <div className="ct-fade-up absolute bottom-6 left-6 w-[min(380px,calc(100%-3rem))] border border-white/25 bg-black/90 p-4">
      <div className="flex items-start gap-3">
        {track.cover_url && <img src={track.cover_url} alt="" className="h-14 w-14 shrink-0 object-cover" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{track.title}</div>
          <div className="truncate text-xs text-white/60">{track.artist}</div>
          {details && <div className="mt-1 text-[10px] uppercase tracking-[0.15em] text-white/40">{details}</div>}
        </div>
        <button onClick={onClose} className="text-white/40 hover:text-white" aria-label="Close">
          ×
        </button>
      </div>
      {track.mood_description && <p className="mt-3 text-[11px] leading-relaxed text-white/70">{track.mood_description}</p>}
      {about && <div className="mt-2 text-[10px] uppercase tracking-[0.15em] text-white/40">{about}</div>}
      {track.themes.length > 0 && <div className="mt-1 text-[10px] text-white/40">{track.themes.join(' · ')}</div>}
      {track.genius_url && (
        <a
          href={track.genius_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-[10px] uppercase tracking-[0.15em] text-white/50 underline hover:text-white"
        >
          lyrics on genius ↗
        </a>
      )}
    </div>
  )
}
