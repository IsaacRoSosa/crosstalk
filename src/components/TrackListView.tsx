// The songs of a nucleus as a table, for managing them: search, filter by emotion, sort,
// select (shift-click for a range), then remove, or move/copy to another nucleus.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Pause, Play, Search, X } from 'lucide-react'
import { EMOTIONS, type Emotion, type Track } from '../types/track'

export interface NucleusOption {
  id: number
  name: string
  trackCount: number
}

// Where selected songs go: an existing nucleus, or a new one with this name
export type TransferTarget = { nucleusId: number } | { newName: string }

interface TrackListViewProps {
  tracks: Track[]
  otherNuclei: NucleusOption[]
  // Guests have a single nucleus, so moving and copying need a Google account
  canOrganize: boolean
  canCreateNucleus: boolean
  playingTrackId: number | null
  isPlaying: boolean
  onPlay: (track: Track) => void
  onTogglePlayback: () => void
  onRemove: (trackIds: number[]) => Promise<void>
  // Resolves with a short message to show, e.g. "moved 4 songs to night drive"
  onTransfer: (trackIds: number[], target: TransferTarget, mode: 'copy' | 'move') => Promise<string>
  onSaveWithGoogle: () => void
}

type SortKey = 'added' | 'title' | 'artist' | 'emotion' | 'energy' | 'valence'
type SortDir = 'asc' | 'desc'

const COLUMNS: Array<{ key: SortKey; label: string; className: string; defaultDir: SortDir }> = [
  { key: 'title', label: 'song', className: 'flex-1 min-w-0', defaultDir: 'asc' },
  { key: 'emotion', label: 'emotion', className: 'w-24 hidden sm:block', defaultDir: 'asc' },
  { key: 'energy', label: 'energy', className: 'w-20 hidden md:block', defaultDir: 'desc' },
  { key: 'valence', label: 'valence', className: 'w-20 hidden md:block', defaultDir: 'desc' },
  { key: 'added', label: 'added', className: 'w-20 hidden lg:block', defaultDir: 'desc' },
]

function compare(a: Track, b: Track, key: SortKey): number {
  switch (key) {
    case 'added':
      return a.added_at.localeCompare(b.added_at)
    case 'title':
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    case 'artist':
      return a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' })
    case 'emotion':
      return a.emotion.localeCompare(b.emotion)
    case 'energy':
    case 'valence':
      // Songs without a value go last either way
      return (a[key] ?? -1) - (b[key] ?? -1)
  }
}

function formatAdded(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days < 1) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function Meter({ value }: { value: number | null }) {
  if (value === null) return <span className="text-white/25">-</span>
  return (
    <div className="flex items-center gap-1.5" title={value.toFixed(2)}>
      <div className="h-1 w-10 bg-white/15">
        <div className="h-full bg-white/80" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
    </div>
  )
}

export function TrackListView({
  tracks,
  otherNuclei,
  canOrganize,
  canCreateNucleus,
  playingTrackId,
  isPlaying,
  onPlay,
  onTogglePlayback,
  onRemove,
  onTransfer,
  onSaveWithGoogle,
}: TrackListViewProps) {
  const [query, setQuery] = useState('')
  const [emotionFilter, setEmotionFilter] = useState<Emotion | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'added', dir: 'desc' })
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [expanded, setExpanded] = useState<number | null>(null)
  const [menu, setMenu] = useState<'move' | 'copy' | 'remove' | null>(null)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const lastClicked = useRef<number | null>(null)

  // Drop selections of songs that left the nucleus
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(tracks.map((t) => t.id))
      const next = new Set([...prev].filter((id) => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [tracks])

  useEffect(() => {
    if (!message) return
    const timeout = setTimeout(() => setMessage(null), 5000)
    return () => clearTimeout(timeout)
  }, [message])

  const emotionCounts = useMemo(() => {
    const counts = new Map<Emotion, number>()
    for (const t of tracks) counts.set(t.emotion, (counts.get(t.emotion) ?? 0) + 1)
    return EMOTIONS.flatMap((e) => (counts.has(e) ? [[e, counts.get(e)!] as const] : []))
  }, [tracks])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = tracks.filter(
      (t) =>
        (!emotionFilter || t.emotion === emotionFilter) &&
        (!q || [t.title, t.artist, t.album ?? '', t.genre ?? ''].some((field) => field.toLowerCase().includes(q))),
    )
    const sign = sort.dir === 'asc' ? 1 : -1
    return filtered.sort((a, b) => sign * compare(a, b, sort.key) || b.added_at.localeCompare(a.added_at))
  }, [tracks, query, emotionFilter, sort])

  const selectedIds = [...selected]
  const allVisibleSelected = visible.length > 0 && visible.every((t) => selected.has(t.id))

  const toggleSort = (key: SortKey, defaultDir: SortDir) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: defaultDir }))

  const toggleOne = (index: number, shiftKey: boolean) => {
    const id = visible[index].id
    setSelected((prev) => {
      const next = new Set(prev)
      if (shiftKey && lastClicked.current !== null) {
        // Shift-click selects (or clears) the whole range, matching the clicked row's new state
        const [from, to] = [Math.min(lastClicked.current, index), Math.max(lastClicked.current, index)]
        const select = !prev.has(id)
        for (const t of visible.slice(from, to + 1)) {
          if (select) next.add(t.id)
          else next.delete(t.id)
        }
      } else if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
    lastClicked.current = index
  }

  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev)
      for (const t of visible) {
        if (allVisibleSelected) next.delete(t.id)
        else next.add(t.id)
      }
      return next
    })

  const run = async (action: () => Promise<string | void>) => {
    setBusy(true)
    try {
      const result = await action()
      if (result) setMessage(result)
      setMenu(null)
      setNewName('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const songs = (n: number) => `${n} song${n === 1 ? '' : 's'}`

  return (
    <div className="font-mono text-white">
      {/* Search and emotion filters */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/15 pb-3">
        <label className="flex min-w-[200px] flex-1 items-center gap-2 border border-white/25 px-3 py-2 focus-within:border-white">
          <Search className="h-3.5 w-3.5 shrink-0 text-white/40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search songs, artists, genres"
            className="w-full bg-transparent text-xs text-white placeholder-white/30 focus:outline-none"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-white/40 hover:text-white" aria-label="Clear search">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>
        <div className="flex flex-wrap gap-1">
          {emotionCounts.map(([emotion, count]) => (
            <button
              key={emotion}
              onClick={() => setEmotionFilter(emotionFilter === emotion ? null : emotion)}
              className={`border px-2 py-1 text-[10px] uppercase tracking-[0.12em] transition-colors ${
                emotionFilter === emotion ? 'border-white bg-white text-black' : 'border-white/25 text-white/60 hover:border-white/60 hover:text-white'
              }`}
            >
              {emotion} <span className="opacity-50">{count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Selection actions */}
      <div className="sticky top-0 z-10 flex min-h-[44px] flex-wrap items-center gap-2 border-b border-white/15 bg-black py-2 text-[11px]">
        {selected.size === 0 ? (
          <span className="text-white/40">
            {visible.length === tracks.length ? songs(tracks.length) : `${visible.length} of ${songs(tracks.length)}`} · select songs to remove or
            organize them
          </span>
        ) : (
          <>
            <span className="text-white">{selected.size} selected</span>
            <button onClick={() => setSelected(new Set())} className="text-white/40 underline hover:text-white">
              clear
            </button>
            <span className="mx-1 h-4 w-px bg-white/20" />
            {(['move', 'copy'] as const).map((mode) => (
              <button
                key={mode}
                disabled={busy}
                onClick={() => setMenu(menu === mode ? null : mode)}
                className={`flex items-center gap-1 border px-2.5 py-1 uppercase tracking-[0.12em] transition-colors disabled:opacity-40 ${
                  menu === mode ? 'border-white bg-white text-black' : 'border-white/30 hover:border-white'
                }`}
              >
                {mode} to <ChevronDown className="h-3 w-3" />
              </button>
            ))}
            <button
              disabled={busy}
              onClick={() => setMenu(menu === 'remove' ? null : 'remove')}
              className={`border px-2.5 py-1 uppercase tracking-[0.12em] transition-colors disabled:opacity-40 ${
                menu === 'remove' ? 'border-white bg-white text-black' : 'border-white/30 hover:border-white'
              }`}
            >
              remove
            </button>
          </>
        )}
        {message && <span className="ml-auto text-white/70">{message}</span>}

        {/* Menus open under the bar */}
        {menu && selected.size > 0 && (
          <div className="absolute left-0 top-full z-20 mt-1 w-[min(340px,100%)] border border-white/30 bg-black p-3 shadow-[0_8px_30px_rgba(0,0,0,0.8)]">
            {menu === 'remove' ? (
              <>
                <p className="text-white/70">
                  Remove {songs(selected.size)} from this nucleus? They stay in your other nuclei, and you can add them back any time.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    disabled={busy}
                    onClick={() => run(async () => {
                      await onRemove(selectedIds)
                      setSelected(new Set())
                      return `removed ${songs(selectedIds.length)}`
                    })}
                    className="bg-white px-3 py-1.5 font-semibold text-black hover:bg-white/85 disabled:opacity-40"
                  >
                    {busy ? 'removing...' : 'remove'}
                  </button>
                  <button onClick={() => setMenu(null)} className="px-3 py-1.5 text-white/50 hover:text-white">
                    cancel
                  </button>
                </div>
              </>
            ) : !canOrganize ? (
              <>
                <p className="text-white/70">
                  Guests have one nucleus. Save with Google to split your songs into more nuclei, one per mood or playlist.
                </p>
                <button onClick={onSaveWithGoogle} className="mt-3 bg-white px-3 py-1.5 font-semibold text-black hover:bg-white/85">
                  save with google
                </button>
              </>
            ) : (
              <>
                <p className="mb-2 text-[10px] uppercase tracking-[0.15em] text-white/40">
                  {menu} {songs(selected.size)} to
                </p>
                <div className="max-h-56 space-y-1 overflow-y-auto">
                  {otherNuclei.map((n) => (
                    <button
                      key={n.id}
                      disabled={busy}
                      onClick={() => run(async () => {
                        const result = await onTransfer(selectedIds, { nucleusId: n.id }, menu)
                        setSelected(new Set())
                        return result
                      })}
                      className="flex w-full items-center justify-between gap-2 border border-white/15 px-2.5 py-2 text-left hover:border-white disabled:opacity-40"
                    >
                      <span className="truncate">{n.name.toLowerCase()}</span>
                      <span className="shrink-0 text-white/40">{n.trackCount}</span>
                    </button>
                  ))}
                </div>
                {canCreateNucleus ? (
                  <form
                    className="mt-2 flex gap-1"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const name = newName.trim()
                      if (!name) return
                      run(async () => {
                        const result = await onTransfer(selectedIds, { newName: name }, menu)
                        setSelected(new Set())
                        return result
                      })
                    }}
                  >
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      maxLength={80}
                      placeholder="or a new nucleus named..."
                      className="min-w-0 flex-1 border border-white/25 bg-transparent px-2.5 py-2 text-white placeholder-white/30 focus:border-white focus:outline-none"
                    />
                    <button type="submit" disabled={busy || !newName.trim()} className="bg-white px-3 font-semibold text-black disabled:opacity-30">
                      {busy ? '...' : 'go'}
                    </button>
                  </form>
                ) : (
                  <p className="mt-2 text-white/40">You've reached the nucleus limit, so songs can only go to existing ones.</p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-3 border-b border-white/15 py-2 text-[10px] uppercase tracking-[0.15em] text-white/40">
        <input
          type="checkbox"
          checked={allVisibleSelected}
          onChange={toggleAllVisible}
          className="h-3.5 w-3.5 shrink-0 accent-white"
          aria-label="Select all shown songs"
        />
        <span className="w-4 shrink-0" />
        <span className="w-9 shrink-0" />
        {COLUMNS.map((col) => (
          <button
            key={col.key}
            onClick={() => toggleSort(col.key, col.defaultDir)}
            className={`flex items-center gap-1 text-left uppercase hover:text-white ${col.className} ${sort.key === col.key ? 'text-white' : ''}`}
          >
            {col.label}
            {sort.key === col.key && (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
          </button>
        ))}
        <span className="w-8 shrink-0" />
      </div>

      {/* Rows */}
      {visible.length === 0 && (
        <p className="py-12 text-center text-xs text-white/40">
          {tracks.length === 0 ? 'No songs yet. Paste some in the sidebar.' : 'No songs match.'}
        </p>
      )}
      <ul>
        {visible.map((track, index) => {
          const isSelected = selected.has(track.id)
          const isOpen = expanded === track.id
          const isCurrent = playingTrackId === track.id
          return (
            <li key={track.id} className={`border-b border-white/10 ${isSelected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'}`}>
              <div className="flex items-center gap-3 py-2">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onClick={(e) => toggleOne(index, e.shiftKey)}
                  onChange={() => {}}
                  className="h-3.5 w-3.5 shrink-0 accent-white"
                  aria-label={`Select ${track.title}`}
                />
                <button
                  onClick={() => setExpanded(isOpen ? null : track.id)}
                  className="w-4 shrink-0 text-white/40 hover:text-white"
                  aria-label={isOpen ? 'Hide details' : 'Show details'}
                >
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
                {track.cover_url ? (
                  <img src={track.cover_url} alt="" loading="lazy" className="h-9 w-9 shrink-0 object-cover" />
                ) : (
                  <span className="h-9 w-9 shrink-0 border border-white/15" />
                )}
                <button onClick={() => setExpanded(isOpen ? null : track.id)} className="min-w-0 flex-1 text-left">
                  <span className={`block truncate text-xs ${isCurrent ? 'text-white' : 'text-white/90'}`}>{track.title}</span>
                  <span className="block truncate text-[11px] text-white/45">
                    {track.artist}
                    {track.genre ? ` · ${track.genre}` : ''}
                  </span>
                </button>
                <span className="hidden w-24 text-[10px] uppercase tracking-[0.12em] text-white/60 sm:block">{track.emotion}</span>
                <span className="hidden w-20 md:block">
                  <Meter value={track.energy} />
                </span>
                <span className="hidden w-20 md:block">
                  <Meter value={track.valence} />
                </span>
                <span className="hidden w-20 text-[11px] text-white/40 lg:block">{formatAdded(track.added_at)}</span>
                <button
                  onClick={() => (isCurrent ? onTogglePlayback() : onPlay(track))}
                  className={`flex h-7 w-8 shrink-0 items-center justify-center border transition-colors ${
                    isCurrent ? 'border-white text-white' : 'border-white/20 text-white/50 hover:border-white hover:text-white'
                  }`}
                  aria-label={isCurrent && isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
                >
                  {isCurrent && isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                </button>
              </div>
              {isOpen && (
                <div className="mb-3 ml-[4.5rem] mr-10 space-y-2 text-[11px] leading-relaxed text-white/60">
                  {track.mood_description && <p>{track.mood_description}</p>}
                  {track.lyrical_style && (
                    <p>
                      <span className="text-white/35">style:</span> {track.lyrical_style}
                    </p>
                  )}
                  <p className="text-white/35 sm:hidden">
                    {track.emotion} · energy {track.energy?.toFixed(2) ?? '-'} · valence {track.valence?.toFixed(2) ?? '-'}
                  </p>
                  <div className="flex flex-wrap gap-3 text-white/50">
                    {track.album && <span>{track.album}</span>}
                    {track.genius_url && (
                      <a href={track.genius_url} target="_blank" rel="noopener noreferrer" className="underline hover:text-white">
                        lyrics
                      </a>
                    )}
                    {track.spotify_id && (
                      <a href={`https://open.spotify.com/track/${track.spotify_id}`} target="_blank" rel="noopener noreferrer" className="underline hover:text-white">
                        spotify
                      </a>
                    )}
                    {track.deezer_id && (
                      <a href={`https://www.deezer.com/track/${track.deezer_id}`} target="_blank" rel="noopener noreferrer" className="underline hover:text-white">
                        deezer
                      </a>
                    )}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
