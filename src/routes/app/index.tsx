import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Lock, Plus } from 'lucide-react'
import { Eyebrow, PulseDot, Wordmark, primaryButtonClass } from '../../components/ui'
import { getSupabaseBrowserClient } from '../../lib/supabase/client'
import { saveWithGoogle, toAccountInfo, type AccountInfo } from '../../lib/auth'
import { ApiError, deleteNucleus, listNuclei, renameNucleus, type NucleusLibrary } from '../../lib/nuclei-client'
import { EMOTIONS, type Emotion } from '../../types/track'
import { GUEST_RETENTION_DAYS, type NucleusSummary } from '../../types/nucleus'

export const Route = createFileRoute('/app/')({
  component: Library,
  head: () => ({ meta: [{ title: 'Your nuclei · Crosstalk' }] }),
})

// The user's nuclei as planets. Each one is painted with its songs' album covers and ringed by
// its mix of emotions. Guests have one; saving with Google unlocks more.
function Library() {
  const [library, setLibrary] = useState<NucleusLibrary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      setLibrary(await listNuclei())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your nuclei')
    }
  }

  useEffect(() => {
    load()
  }, [])

  const nuclei = library?.nuclei ?? []
  const totalSongs = nuclei.reduce((sum, n) => sum + n.trackCount, 0)
  const canCreate = library !== null && !library.isAnonymous && nuclei.length < library.limit

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-black font-mono text-white">
      <div className="ct-starfield fixed inset-0" />
      <div className="ct-scanlines fixed inset-0" />

      <header className="relative z-10 flex items-center justify-between gap-4 px-6 py-5">
        <Wordmark />
        <AccountChip />
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-20">
        <div className="ct-fade-up mt-6 max-w-xl">
          <Eyebrow>your nuclei</Eyebrow>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
            {library === null ? '...' : `${nuclei.length} ${nuclei.length === 1 ? 'nucleus' : 'nuclei'}, ${totalSongs} songs`}
          </h1>
          <p className="mt-3 text-xs leading-relaxed text-white/50">
            {library?.isAnonymous
              ? `Each nucleus is one collection of songs, read for mood. As a guest, yours lives in this browser and is deleted after ${GUEST_RETENTION_DAYS} days without a visit. Save with Google to keep it and make more, one per playlist or mood.`
              : 'Each nucleus is one collection of songs, read for mood. Make one per playlist or mood, and move songs between them from the list view.'}
          </p>
        </div>

        {error && (
          <div className="mt-8 max-w-xl border border-white/40 bg-white/5 p-3 text-xs text-white/80">
            {error}{' '}
            <button onClick={load} className="underline hover:text-white">
              try again
            </button>
          </div>
        )}

        <div className="mt-12 grid grid-cols-1 gap-x-6 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
          {nuclei.map((nucleus, index) => (
            <PlanetCard
              key={nucleus.id}
              nucleus={nucleus}
              index={index}
              canDelete={nuclei.length > 1}
              onChanged={load}
            />
          ))}
          {library && (canCreate ? <NewPlanet /> : library.isAnonymous ? <LockedPlanet /> : <LimitReached limit={library.limit} />)}
        </div>
      </main>
    </div>
  )
}

// ── Planets ─────────────────────────────────────────────────────────────────

// Grays for the ring segments, one per emotion, so neighbouring emotions stay distinguishable
const EMOTION_SHADES: Record<Emotion, string> = {
  joy: 'rgba(255,255,255,0.95)',
  love: 'rgba(255,255,255,0.8)',
  surprise: 'rgba(255,255,255,0.65)',
  calm: 'rgba(255,255,255,0.5)',
  nostalgia: 'rgba(255,255,255,0.4)',
  sadness: 'rgba(255,255,255,0.3)',
  fear: 'rgba(255,255,255,0.22)',
  anger: 'rgba(255,255,255,0.15)',
}

function emotionMix(nucleus: NucleusSummary): Array<{ emotion: Emotion; count: number; share: number }> {
  const total = Object.values(nucleus.emotions).reduce((sum, n) => sum + (n ?? 0), 0)
  if (total === 0) return []
  return EMOTIONS.flatMap((emotion) => {
    const count = nucleus.emotions[emotion] ?? 0
    return count > 0 ? [{ emotion, count, share: count / total }] : []
  }).sort((a, b) => b.count - a.count)
}

// The ring: a conic gradient with one segment per emotion, cut to a thin band
function ringBackground(mix: ReturnType<typeof emotionMix>): string {
  if (mix.length === 0) return 'rgba(255,255,255,0.18)'
  let start = 0
  const stops = mix.flatMap(({ emotion, share }) => {
    const end = start + share * 360
    const segment = [`${EMOTION_SHADES[emotion]} ${start}deg`, `${EMOTION_SHADES[emotion]} ${Math.max(start, end - 2)}deg`, `transparent ${Math.max(start, end - 2)}deg`, `transparent ${end}deg`]
    start = end
    return segment
  })
  return `conic-gradient(${stops.join(', ')})`
}

function planetSize(trackCount: number): number {
  // Grows with the collection, then levels off so big nuclei don't take over the page
  return Math.round(96 + Math.min(84, Math.sqrt(trackCount) * 14))
}

// How long the destruction plays before the card leaves the grid (matches ct-card-vanish)
const DESTROY_MS = 1050

// Fragments the planet breaks into: pieces of its covers (or plain white), thrown outward in a
// fixed but uneven pattern so every destruction looks the same and nothing jumps on re-render
function Debris({ covers, size }: { covers: string[]; size: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => {
        const angle = (i / 16) * Math.PI * 2 + ((i * 37) % 11) * 0.05
        const distance = size * (0.75 + ((i * 53) % 7) * 0.12)
        const piece = Math.round(size * (0.1 + ((i * 29) % 5) * 0.03))
        return {
          key: i,
          style: {
            width: piece,
            height: piece,
            backgroundImage: covers.length > 0 ? `url(${covers[i % covers.length]})` : undefined,
            backgroundColor: covers.length > 0 ? undefined : 'rgba(255,255,255,0.85)',
            animationDelay: `${((i * 17) % 6) * 20}ms`,
            '--dx': `${Math.round(Math.cos(angle) * distance)}px`,
            '--dy': `${Math.round(Math.sin(angle) * distance * 0.8)}px`,
            '--rot': `${((i * 71) % 360) - 180}deg`,
          } as CSSProperties,
        }
      }),
    [covers, size],
  )
  return (
    <>
      <span className="ct-shockwave" style={{ width: size * 1.1, height: size * 1.1 }} />
      {pieces.map((piece) => (
        <span key={piece.key} className="ct-debris" style={piece.style} />
      ))}
    </>
  )
}

function Planet({ nucleus, size, destroying = false }: { nucleus: NucleusSummary; size: number; destroying?: boolean }) {
  const mix = emotionMix(nucleus)
  // Fill a 3x3 grid, repeating covers when there are fewer than 9
  const tiles = nucleus.covers.length > 0 ? Array.from({ length: 9 }, (_, i) => nucleus.covers[i % nucleus.covers.length]) : []
  const ringSize = size * 1.75
  const ringMask = 'radial-gradient(closest-side, transparent 86%, #000 87%, #000 96%, transparent 97%)'

  return (
    <div className="relative flex items-center justify-center" style={{ width: ringSize, height: size * 1.25 }}>
      {/* Back half of the ring */}
      <div
        className={`absolute ${destroying ? 'ct-destroy-ring' : ''}`}
        style={{
          width: ringSize,
          height: ringSize,
          background: ringBackground(mix),
          WebkitMaskImage: ringMask,
          maskImage: ringMask,
          transform: 'rotate(-14deg) scaleY(0.22)',
          opacity: 0.55,
        }}
      />
      {/* The planet */}
      <div
        className={`relative overflow-hidden rounded-full border border-white/25 bg-white/[0.04] transition-[filter] duration-500 [filter:grayscale(1)_contrast(1.15)] group-hover:[filter:grayscale(0)] ${destroying ? 'ct-destroy-core' : ''}`}
        style={{ width: size, height: size, boxShadow: '0 0 60px rgba(255,255,255,0.07)' }}
      >
        {tiles.length > 0 && (
          <div className="absolute inset-0 scale-[1.45]">
            <div className="ct-planet-surface grid h-full w-full grid-cols-3 grid-rows-3">
              {tiles.map((src, i) => (
                <img key={i} src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
              ))}
            </div>
          </div>
        )}
        {/* Light from the upper left, shadow toward the lower right, so it reads as a sphere */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              'radial-gradient(circle at 32% 28%, rgba(255,255,255,0.18) 0%, rgba(0,0,0,0) 38%, rgba(0,0,0,0.55) 70%, rgba(0,0,0,0.92) 100%)',
          }}
        />
        <div className="ct-scanlines absolute inset-0 rounded-full" />
      </div>
      {destroying && <Debris covers={nucleus.covers} size={size} />}
      {/* Front half of the ring passes over the planet */}
      <div
        className={`pointer-events-none absolute ${destroying ? 'ct-destroy-ring' : ''}`}
        style={{
          width: ringSize,
          height: ringSize,
          background: ringBackground(mix),
          WebkitMaskImage: ringMask,
          maskImage: ringMask,
          // Only the lower half (in the ring's own coordinates), which ends up in front once tilted
          clipPath: 'inset(50% 0 0 0)',
          transform: 'rotate(-14deg) scaleY(0.22)',
        }}
      />
    </div>
  )
}

function PlanetCard({
  nucleus,
  index,
  canDelete,
  onChanged,
}: {
  nucleus: NucleusSummary
  index: number
  canDelete: boolean
  onChanged: () => Promise<void>
}) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'idle' | 'rename' | 'delete'>('idle')
  const [name, setName] = useState(nucleus.name)
  const [busy, setBusy] = useState(false)
  const [destroying, setDestroying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mix = emotionMix(nucleus)
  const size = planetSize(nucleus.trackCount)
  const open = () => navigate({ to: '/app/n/$nucleusId', params: { nucleusId: String(nucleus.id) } })

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      setMode('idle')
      await onChanged()
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  // Deleted on the server first, so a failure never plays the animation; the list reloads once it ends
  const destroy = async () => {
    setBusy(true)
    setError(null)
    try {
      await deleteNucleus(nucleus.id)
      setMode('idle')
      setDestroying(true)
      window.setTimeout(() => {
        onChanged()
      }, DESTROY_MS)
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong')
      setBusy(false)
    }
  }

  const bobStyle: CSSProperties = { animationDelay: `${-index * 1.7}s` }

  return (
    <div
      className={`flex flex-col items-center text-center ${destroying ? 'ct-card-vanish' : 'ct-fade-up'}`}
      style={destroying ? undefined : { animationDelay: `${index * 60}ms` }}
      aria-hidden={destroying || undefined}
    >
      <button
        onClick={open}
        disabled={destroying}
        className="group flex h-[260px] items-center justify-center focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60"
        aria-label={`Open ${nucleus.name}`}
      >
        {/* Only the planet drifts; the button stays put so it's an easy target */}
        <div className="ct-planet-bob" style={bobStyle}>
          <Planet nucleus={nucleus} size={size} destroying={destroying} />
        </div>
      </button>

      {mode === 'rename' ? (
        <form
          className="flex w-full max-w-[260px] gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            const trimmed = name.trim()
            if (!trimmed || trimmed === nucleus.name) return setMode('idle')
            run(() => renameNucleus(nucleus.id, trimmed))
          }}
        >
          <input
            autoFocus
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setMode('idle')}
            className="min-w-0 flex-1 border border-white/40 bg-black px-2 py-1.5 text-xs text-white focus:border-white focus:outline-none"
            aria-label="Nucleus name"
          />
          <button type="submit" disabled={busy} className="bg-white px-3 text-[11px] font-semibold text-black disabled:opacity-40">
            save
          </button>
        </form>
      ) : (
        <button onClick={open} className="max-w-full truncate text-sm font-semibold text-white hover:text-white/80">
          {nucleus.name.toLowerCase()}
        </button>
      )}

      <div className="mt-1 text-[11px] text-white/45">
        {nucleus.trackCount === 0 ? 'empty, add songs to it' : `${nucleus.trackCount} song${nucleus.trackCount === 1 ? '' : 's'}`}
      </div>
      {mix.length > 0 && (
        <div className="mt-1.5 text-[10px] uppercase tracking-[0.14em] text-white/40">
          {mix
            .slice(0, 3)
            .map(({ emotion, share }) => `${emotion} ${Math.round(share * 100)}%`)
            .join(' · ')}
        </div>
      )}

      {nucleus.impression && (
        <button onClick={open} className="mt-3 max-w-[290px] text-left">
          <p className="line-clamp-3 text-[11px] leading-relaxed text-white/55 hover:text-white/75">{nucleus.impression}</p>
        </button>
      )}

      {mode === 'delete' ? (
        <div className="mt-3 text-[11px] text-white/70">
          delete it and its chat? songs stay in your other nuclei.
          <div className="mt-2 flex justify-center gap-3">
            <button
              disabled={busy}
              onClick={destroy}
              className="bg-white px-3 py-1 font-semibold text-black disabled:opacity-40"
            >
              {busy ? 'deleting...' : 'delete'}
            </button>
            <button onClick={() => setMode('idle')} className="text-white/50 hover:text-white">
              cancel
            </button>
          </div>
        </div>
      ) : (
        mode === 'idle' && (
          <div className="mt-2 flex gap-3 text-[10px] uppercase tracking-[0.14em] text-white/30">
            <button onClick={() => { setName(nucleus.name); setMode('rename') }} className="hover:text-white">
              rename
            </button>
            {canDelete && (
              <button onClick={() => setMode('delete')} className="hover:text-white">
                delete
              </button>
            )}
          </div>
        )
      )}
      {error && <p className="mt-2 max-w-[260px] text-[11px] text-white/70">{error}</p>}
    </div>
  )
}

// An empty orbit slot that starts the onboarding for a new nucleus
function NewPlanet() {
  return (
    <div className="ct-fade-up flex flex-col items-center text-center">
      <Link
        to="/start"
        className="group flex h-[260px] items-center justify-center focus:outline-none"
        aria-label="Start a new nucleus"
      >
        <div className="flex h-[110px] w-[110px] items-center justify-center rounded-full border border-dashed border-white/30 text-white/40 transition-colors group-hover:border-white group-hover:text-white">
          <Plus className="h-6 w-6" />
        </div>
      </Link>
      <Link to="/start" className="text-sm font-semibold text-white/70 hover:text-white">
        new nucleus
      </Link>
      <div className="mt-1 text-[11px] text-white/40">paste another playlist or mood</div>
    </div>
  )
}

function LockedPlanet() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="ct-fade-up flex flex-col items-center text-center">
      <div className="flex h-[260px] items-center justify-center">
        <div className="flex h-[110px] w-[110px] items-center justify-center rounded-full border border-dashed border-white/20 text-white/30">
          <Lock className="h-5 w-5" />
        </div>
      </div>
      <div className="text-sm font-semibold text-white/70">more nuclei</div>
      <p className="mt-1 max-w-[260px] text-[11px] leading-relaxed text-white/40">
        Save with Google to keep your nucleus and make more, one per playlist or mood.
      </p>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            await saveWithGoogle()
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not open Google')
            setBusy(false)
          }
        }}
        className={`${primaryButtonClass} mt-4 !px-4 !py-2.5`}
      >
        {busy ? 'opening google...' : 'save with google'}
      </button>
      {error && <p className="mt-2 max-w-[260px] text-[11px] text-white/70">{error}</p>}
    </div>
  )
}

function LimitReached({ limit }: { limit: number }) {
  return (
    <div className="flex flex-col items-center justify-center text-center text-[11px] text-white/40">
      <div className="flex h-[260px] items-center">
        <span>
          {limit} of {limit} nuclei. Delete one to make room.
        </span>
      </div>
    </div>
  )
}

// ── Account ─────────────────────────────────────────────────────────────────

function AccountChip() {
  const [account, setAccount] = useState<AccountInfo | null>(null)
  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    supabase.auth.getSession().then(({ data }) => setAccount(toAccountInfo(data.session?.user)))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setAccount(toAccountInfo(session?.user)))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!account) return null
  if (account.isAnonymous) {
    return (
      <Link to="/profile" className="flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-white/40 hover:text-white">
        <PulseDot size={5} /> guest · profile
      </Link>
    )
  }
  return (
    <Link to="/profile" className="flex min-w-0 items-center gap-3 text-[11px] text-white/60 hover:text-white" title="Profile">
      {account.avatarUrl && <img src={account.avatarUrl} alt="" className="h-6 w-6 rounded-full" referrerPolicy="no-referrer" />}
      <span className="hidden truncate sm:inline">{account.name ?? account.email}</span>
      <span className="text-[10px] uppercase tracking-[0.15em] text-white/40">profile</span>
    </Link>
  )
}
