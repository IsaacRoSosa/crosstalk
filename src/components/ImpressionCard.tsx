// A nucleus's first impression: what its songs seem to say about the person.
import { useState } from 'react'
import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react'

interface ImpressionCardProps {
  impression: string | null
  // How many songs the nucleus had when it was read, to say when it's out of date
  readWithTracks: number | null
  trackCount: number
  busy: boolean
  error: string | null
  onRead: () => void
  className?: string
}

export function ImpressionCard({ impression, readWithTracks, trackCount, busy, error, onRead, className = '' }: ImpressionCardProps) {
  const [open, setOpen] = useState(true)
  if (trackCount === 0) return null

  const changed = readWithTracks !== null && readWithTracks !== trackCount
  const label = busy ? 'reading...' : impression ? 'read again' : 'read me'

  return (
    <div className={`border border-white/25 bg-black/85 font-mono ${className}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-white/50">first impression</span>
        {changed && !busy && (
          <span className="text-[10px] text-white/35">
            · read with {readWithTracks} song{readWithTracks === 1 ? '' : 's'}, now {trackCount}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {(impression === null || changed || open) && (
            <button
              onClick={onRead}
              disabled={busy}
              className="flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] text-white/50 hover:text-white disabled:opacity-50"
              title="Uses one free AI request"
            >
              <RotateCcw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} /> {label}
            </button>
          )}
          {impression && (
            <button onClick={() => setOpen(!open)} className="text-white/40 hover:text-white" aria-label={open ? 'Collapse' : 'Expand'}>
              {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          )}
        </span>
      </div>
      {open && (impression || error) && (
        <div className="border-t border-white/10 px-3 pb-3 pt-2.5">
          {impression && <p className={`text-[12px] leading-relaxed text-white/85 ${busy ? 'opacity-40' : ''}`}>{impression}</p>}
          {error && <p className="mt-1 text-[11px] text-white/60">{error}</p>}
        </div>
      )}
      {!impression && !error && open && (
        <p className="border-t border-white/10 px-3 pb-3 pt-2.5 text-[11px] text-white/45">
          Have the AI read these songs together and tell you what they seem to say about you.
        </p>
      )}
    </div>
  )
}
