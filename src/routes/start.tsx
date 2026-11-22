import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NucleusVisualization } from '../components/NucleusVisualization'
import { Eyebrow, GhostButton, Panel, PanelHeader, PrimaryButton, ghostButtonClass, primaryButtonClass, Wordmark } from '../components/ui'
import { apiFetch } from '../lib/api-client'
import { isEmptyImport, parseImportInput, type ParsedImportInput } from '../lib/import-input'
import { importSongs, type ImportResult } from '../lib/import-client'
import { ApiError, autoNameNucleus, createNucleus, listTracks } from '../lib/nuclei-client'
import { listenForAiConnected, startOpenRouterConnect } from '../lib/openrouter-connect'
import { getTemp, removeTemp, setTemp } from '../lib/temp-storage'
import type { Track } from '../types/track'
import '../styles/galaxy.css'

export const Route = createFileRoute('/start')({
  component: Start,
  head: () => ({ meta: [{ title: 'Start your nucleus · Crosstalk' }] }),
})

type Step = 'music' | 'ai' | 'forming'

// What the person pasted, kept across reloads and the OpenRouter tab (localStorage, for a day)
const PENDING_IMPORT_KEY = 'crosstalk.pendingImport'
// The nucleus being filled, so retrying after connecting the AI adds to the same one
const PENDING_NUCLEUS_KEY = 'crosstalk.pendingNucleus'
const PENDING_IMPORT_TTL_MS = 24 * 60 * 60 * 1000

function readStepFromUrl(): Step {
  if (typeof window === 'undefined') return 'music'
  const step = new URLSearchParams(window.location.search).get('step')
  return step === 'ai' || step === 'forming' ? step : 'music'
}

function setStepInUrl(step: Step) {
  const url = new URL(window.location.href)
  if (step === 'music') url.searchParams.delete('step')
  else url.searchParams.set('step', step)
  window.history.replaceState(null, '', url)
}

function countSongs(parsed: ParsedImportInput): number {
  return parsed.spotifyTrackIds.length + parsed.deezerTrackIds.length
}

function hasPlaylist(parsed: ParsedImportInput): boolean {
  return parsed.deezerPlaylistIds.length > 0 || parsed.deezerShortLinks.length > 0
}

// Onboarding: add your music → connect a free AI → watch the nucleus form
function Start() {
  const [step, setStepState] = useState<Step>('music')

  useEffect(() => {
    const fromUrl = readStepFromUrl()
    // Without pending music there's nothing to connect or form yet
    setStepState(fromUrl !== 'music' && !getTemp(PENDING_IMPORT_KEY) ? 'music' : fromUrl)
  }, [])

  const setStep = useCallback((next: Step) => {
    setStepInUrl(next)
    setStepState(next)
  }, [])

  if (step === 'forming') return <FormingStep onBack={() => setStep('music')} />

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="px-6 pt-6 md:px-10">
        <Wordmark />
      </header>
      <main className="flex min-h-[calc(100vh-60px)] items-center justify-center px-4 py-12">
        {step === 'music' ? <MusicStep onContinue={() => setStep('ai')} /> : <AiStep onBack={() => setStep('music')} onReady={() => setStep('forming')} />}
      </main>
    </div>
  )
}

// ── Step 1: your music ──────────────────────────────────────────────────────

function MusicStep({ onContinue }: { onContinue: () => void }) {
  const [input, setInput] = useState('')

  useEffect(() => {
    setInput(getTemp(PENDING_IMPORT_KEY) ?? '')
  }, [])

  const parsed = useMemo(() => parseImportInput(input), [input])
  const songs = countSongs(parsed)
  const playlists = parsed.deezerPlaylistIds.length + parsed.deezerShortLinks.length
  const onlySpotifyPlaylists = parsed.spotifyPlaylistIds.length > 0 && songs === 0 && playlists === 0

  const detected: string[] = []
  if (parsed.spotifyTrackIds.length) detected.push(`${parsed.spotifyTrackIds.length} spotify song${parsed.spotifyTrackIds.length === 1 ? '' : 's'}`)
  if (parsed.deezerTrackIds.length) detected.push(`${parsed.deezerTrackIds.length} deezer song${parsed.deezerTrackIds.length === 1 ? '' : 's'}`)
  if (playlists) detected.push(`${playlists} deezer playlist${playlists === 1 ? '' : 's'}`)

  const canContinue = (songs > 0 || playlists > 0) && !isEmptyImport(parsed)

  const handleContinue = () => {
    setTemp(PENDING_IMPORT_KEY, input, PENDING_IMPORT_TTL_MS)
    // New songs: pick the nucleus again when forming starts
    removeTemp(PENDING_NUCLEUS_KEY)
    onContinue()
  }

  return (
    <div className="ct-fade-up w-full max-w-[600px]">
      <Panel>
        <PanelHeader title="your music" step="step 1 / 2" />
        <div className="space-y-5 p-5">
          <p className="text-xs leading-relaxed text-white/60">
            paste the songs you keep coming back to. crosstalk reads their lyrics, never your account: there's nothing to log
            in to.
          </p>

          <div className="space-y-3 text-[11px] leading-relaxed">
            <SourceRow
              mark="S"
              name="spotify"
              detail="in the desktop app, open a playlist, select songs (cmd/ctrl+a) and copy them (cmd/ctrl+c)"
            />
            <SourceRow mark="D" name="deezer" detail="paste a link to a public playlist or a song" />
            <SourceRow mark="A" name="apple music" detail="coming later" muted />
          </div>

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={6}
            placeholder={'https://open.spotify.com/track/...\nhttps://open.spotify.com/track/...\nor https://www.deezer.com/playlist/...'}
            className="w-full resize-y border border-white/30 bg-black p-3 text-xs text-white placeholder-white/25 focus:border-white focus:outline-none"
            aria-label="Song or playlist links"
          />

          <div className="min-h-[18px] text-[11px] text-white/60" aria-live="polite">
            {onlySpotifyPlaylists
              ? "spotify doesn't let apps read playlists. copy the songs from the playlist instead (see above)."
              : detected.length > 0
                ? `found ${detected.join(' · ')}${songs > 25 || playlists > 0 ? ' · the first 25 with lyrics will be added' : ''}${parsed.spotifyPlaylistIds.length > 0 ? " · spotify playlist links are skipped (copy their songs instead)" : ''}`
                : input.trim()
                  ? "no spotify or deezer links found yet"
                  : ''}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-white/20 p-4">
          <Link to="/example" className="text-[10px] uppercase tracking-[0.15em] text-white/50 hover:text-white">
            see an example first
          </Link>
          <PrimaryButton onClick={handleContinue} disabled={!canContinue}>
            continue →
          </PrimaryButton>
        </div>
      </Panel>
    </div>
  )
}

function SourceRow({ mark, name, detail, muted = false }: { mark: string; name: string; detail: string; muted?: boolean }) {
  return (
    <div className={`flex items-start gap-3 ${muted ? 'opacity-40' : ''}`}>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/40 text-[10px]">{mark}</span>
      <div>
        <div className="font-semibold">{name}</div>
        <div className="text-white/50">{detail}</div>
      </div>
    </div>
  )
}

// ── Step 2: connect a free AI ───────────────────────────────────────────────

function AiStep({ onBack, onReady }: { onBack: () => void; onReady: () => void }) {
  const [checking, setChecking] = useState(true)
  const [agreed, setAgreed] = useState(false)
  const [connecting, setConnecting] = useState(false)
  // OpenRouter is open in another tab; this page continues when it reports back
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => listenForAiConnected(onReady), [onReady])

  const checkAgain = async () => {
    setError(null)
    try {
      const res = await apiFetch('/api/ai/connection')
      const data = await res.json()
      if (data.connected) onReady()
      else setError("not connected yet. finish on openrouter's page, or connect again.")
    } catch {
      setError('could not check the connection')
    }
  }

  // Already connected (e.g. a returning user): go straight to forming
  useEffect(() => {
    apiFetch('/api/ai/connection')
      .then((res) => res.json())
      .then((data) => (data.connected ? onReady() : setChecking(false)))
      .catch(() => setChecking(false))
  }, [onReady])

  const connect = async () => {
    setConnecting(true)
    setError(null)
    try {
      const opened = await startOpenRouterConnect('/start?step=forming')
      if (opened === 'new_tab') {
        setWaiting(true)
        setConnecting(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open OpenRouter')
      setConnecting(false)
    }
  }

  if (checking) return <p className="text-xs text-white/50">checking your ai connection...</p>

  return (
    <div className="ct-fade-up w-full max-w-[600px]">
      <div className="mb-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-white/20" />
        <Eyebrow className="text-white/40">step 2 / 2 · connect a free ai</Eyebrow>
        <div className="h-px flex-1 bg-white/20" />
      </div>
      <Panel>
        <div className="flex items-center gap-3.5 border-b border-white/20 p-5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-black">OR</span>
          <div>
            <div className="text-[13px] font-semibold">crosstalk needs a free ai to read your songs</div>
            <div className="mt-1 text-[10px] text-white/45">you'll connect your own free openrouter account, on openrouter's page</div>
          </div>
        </div>

        <div className="px-5 pb-1 pt-5">
          <Eyebrow className="text-white/40">crosstalk will</Eyebrow>
        </div>
        <ul className="space-y-2.5 px-5 py-3">
          <Check>read each new song's lyrics with a free model to describe its mood</Check>
          <Check>only ever use free models: your key is capped at $0.01</Check>
          <Check>keep your key encrypted on our server, never in your browser</Check>
        </ul>

        <div className="px-5 pb-1 pt-3">
          <Eyebrow className="text-white/40">crosstalk will never</Eyebrow>
        </div>
        <ul className="space-y-2.5 px-5 pb-5 pt-3">
          <Never>use paid models or spend your credits</Never>
          <Never>post, share or publish anything for you</Never>
        </ul>

        <label className="mx-5 mb-5 flex cursor-pointer items-start gap-3 border border-white/15 bg-white/[0.03] p-3.5 text-[11px] leading-relaxed text-white/65">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 accent-white" />
          <span>
            i understand free models may use what they receive (lyrics and my chat with the nucleus) for training, depending on
            my{' '}
            <a href="https://openrouter.ai/settings/privacy" target="_blank" rel="noopener noreferrer" className="text-white underline">
              openrouter privacy settings
            </a>
            .
          </span>
        </label>

        {waiting && (
          <div className="mx-5 mb-5 border border-white/40 p-3.5 text-[11px] leading-relaxed" aria-live="polite">
            <div className="mb-1 flex items-center gap-2 font-semibold">
              <span className="ct-pulse-dot inline-block h-1.5 w-1.5" /> waiting for openrouter
            </div>
            <p className="text-white/60">
              finish in the openrouter tab; this page continues on its own. if you just created your openrouter account and
              it didn't come back here, click connect again: you're signed in now, so it only takes one click.
            </p>
          </div>
        )}

        {error && <p className="px-5 pb-4 text-[11px] text-white/70">{error}</p>}

        <div className="flex flex-wrap justify-end gap-2.5 border-t border-white/20 p-4">
          <GhostButton onClick={onBack}>back</GhostButton>
          {waiting && <GhostButton onClick={checkAgain}>i've connected</GhostButton>}
          {!waiting && (
            <GhostButton onClick={onReady} title="Songs someone else already added still work without ai">
              skip for now
            </GhostButton>
          )}
          <PrimaryButton onClick={connect} disabled={!agreed || connecting}>
            {connecting ? 'opening openrouter...' : waiting ? 'connect again' : 'agree · connect openrouter'}
          </PrimaryButton>
        </div>
      </Panel>
      <p className="mt-3.5 text-center text-[9px] uppercase tracking-[0.12em] text-white/30">
        oauth · pkce · key stored encrypted · disconnect any time
      </p>
    </div>
  )
}

function Check({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-[11px] leading-relaxed">
      <span aria-hidden="true">✓</span>
      <span>{children}</span>
    </li>
  )
}

function Never({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-[11px] leading-relaxed opacity-50">
      <span aria-hidden="true">×</span>
      <span>{children}</span>
    </li>
  )
}

// ── Step 3: forming ─────────────────────────────────────────────────────────

type ImportSummary = Pick<ImportResult, 'successCount' | 'skippedCount' | 'failedCount' | 'notice' | 'aiError'>

type Phase = 'importing' | 'naming' | 'done' | 'failed'

function FormingStep({ onBack }: { onBack: () => void }) {
  const [tracks, setTracks] = useState<Track[]>([])
  const [phase, setPhase] = useState<Phase>('importing')
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [nucleusName, setNucleusName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expected, setExpected] = useState(25)
  const [added, setAdded] = useState(0)
  const [nucleusId, setNucleusId] = useState<number | null>(null)
  const started = useRef(false)

  // The nucleus these songs go into: the one picked earlier in this onboarding if it still exists,
  // otherwise one from the server (an empty one, a guest's only one, or a new one)
  const resolveNucleus = async (): Promise<{ id: number; tracks: Track[] }> => {
    const stored = Number(getTemp(PENDING_NUCLEUS_KEY))
    if (stored > 0) {
      try {
        const { tracks } = await listTracks(stored)
        return { id: stored, tracks }
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) throw err
      }
    }
    const { nucleus } = await createNucleus({ mode: 'onboarding' })
    setTemp(PENDING_NUCLEUS_KEY, String(nucleus.id), PENDING_IMPORT_TTL_MS)
    const { tracks } = await listTracks(nucleus.id)
    return { id: nucleus.id, tracks }
  }

  const run = useCallback(async () => {
    const input = getTemp(PENDING_IMPORT_KEY)
    if (!input) {
      onBack()
      return
    }
    const parsed = parseImportInput(input)
    setExpected(hasPlaylist(parsed) ? 25 : Math.max(1, Math.min(countSongs(parsed), 25)))
    setPhase('importing')
    setError(null)

    let target: { id: number; tracks: Track[] }
    try {
      target = await resolveNucleus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare your nucleus')
      setPhase('failed')
      return
    }
    const before = target.tracks.length
    setNucleusId(target.id)
    setTracks(target.tracks)

    // Show songs entering orbit while the import runs
    const poll = setInterval(async () => {
      try {
        const data = await listTracks(target.id)
        setTracks(data.tracks)
        setAdded(Math.max(0, data.tracks.length - before))
      } catch {
        // keep polling
      }
    }, 2000)

    try {
      const data = await importSongs(target.id, input)
      setSummary(data)
      setAdded(data.successCount)

      const finalData = await listTracks(target.id).catch(() => null)
      if (finalData) setTracks(finalData.tracks)

      if (data.successCount > 0 && !data.aiError) {
        setPhase('naming')
        try {
          const named = await autoNameNucleus(target.id)
          if (named.name) setNucleusName(named.name)
        } catch {
          // a nucleus without a new name is fine
        }
      }
      // Keep the songs (and the nucleus) if the AI wasn't available, so connecting it and coming back retries them
      if (!data.aiError) {
        removeTemp(PENDING_IMPORT_KEY)
        removeTemp(PENDING_NUCLEUS_KEY)
      }
      setPhase('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add your songs')
      setPhase('failed')
    } finally {
      clearInterval(poll)
    }
  }, [onBack])

  useEffect(() => {
    // React dev mode runs effects twice; import once
    if (started.current) return
    started.current = true
    run()
  }, [run])

  const needsAiNow = phase === 'done' && summary?.aiError === 'ai_not_connected'
  // Connected OpenRouter in the other tab: add the songs that needed the AI
  useEffect(() => (needsAiNow ? listenForAiConnected(() => run()) : undefined), [needsAiNow, run])

  const done = phase === 'done'
  const pct = done ? 100 : Math.min(95, Math.round((added / expected) * 100))
  const needsAi = summary?.aiError === 'ai_not_connected'

  const steps: Array<{ label: string; state: 'done' | 'active' | 'waiting'; count?: string }> = [
    { label: 'finding your songs', state: 'done', count: String(expected) },
    { label: 'finding lyrics on lrclib', state: phase === 'importing' ? 'active' : 'done' },
    { label: 'reading mood with a free model', state: phase === 'importing' ? 'active' : 'done' },
    { label: 'placing songs into orbits', state: phase === 'importing' && added === 0 ? 'waiting' : phase === 'importing' ? 'active' : 'done', count: String(added) },
    { label: 'naming the nucleus', state: phase === 'naming' ? 'active' : done ? 'done' : 'waiting' },
  ]

  const title = done
    ? nucleusName
      ? `your nucleus: ${nucleusName.toLowerCase()}`
      : summary && summary.successCount === 0
        ? 'nothing new was added'
        : 'your nucleus is ready'
    : phase === 'failed'
      ? 'something went wrong'
      : `reading ${expected === 25 ? 'your' : expected} song${expected === 1 ? '' : 's'}`

  return (
    <div className="relative h-screen min-h-[560px] overflow-hidden bg-black text-white">
      <div className="absolute inset-0">
        <NucleusVisualization tracks={tracks} />
      </div>
      <div className="ct-scanlines absolute inset-0" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'linear-gradient(90deg, rgba(0,0,0,.95) 0%, rgba(0,0,0,.8) 26%, rgba(0,0,0,0) 46%)' }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[220px]"
        style={{ background: 'linear-gradient(0deg, rgba(0,0,0,.95) 30%, rgba(0,0,0,0))' }}
      />

      <div className="absolute left-6 top-6 w-[min(340px,calc(100%-3rem))] md:left-10 md:top-10">
        <Eyebrow className="mb-3 text-white/40">forming</Eyebrow>
        <h1 className="mb-5 text-2xl font-semibold leading-snug tracking-tight">{title}</h1>
        <ul className="space-y-2">
          {steps.map((s) => (
            <li
              key={s.label}
              className={`flex items-center gap-2.5 text-[10px] ${s.state === 'waiting' ? 'text-white/30' : s.state === 'active' ? 'text-white' : 'text-white/60'}`}
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.state === 'active' ? 'ct-pulse-dot' : s.state === 'done' ? 'bg-white/60' : 'bg-white/20'}`}
              />
              <span className="flex-1">{s.label}</span>
              {s.count && <span className="text-white/30">{s.count}</span>}
            </li>
          ))}
        </ul>

        {done && summary && (
          <p className="ct-fade-up mt-5 text-[11px] leading-relaxed text-white/60">
            {[
              summary.successCount > 0 && `${summary.successCount} added`,
              summary.skippedCount > 0 && `${summary.skippedCount} already in your nucleus`,
              summary.failedCount > 0 && `${summary.failedCount} skipped (no lyrics, instrumental or errors)`,
            ]
              .filter(Boolean)
              .join(' · ')}
            {summary.notice && <span className="mt-2 block text-white/80">{summary.notice}</span>}
          </p>
        )}
        {error && <p className="mt-5 text-[11px] leading-relaxed text-white/80">{error}</p>}
      </div>

      <div className="absolute inset-x-6 bottom-6 md:inset-x-10 md:bottom-10">
        <div className="mb-2.5 flex items-end justify-between">
          <div className="text-[10px] text-white/50">lyrics → mood → orbit placement</div>
          <div className="text-[22px] font-semibold">{pct}%</div>
        </div>
        <div className="h-0.5 bg-white/15">
          <div className="h-full bg-white transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2.5">
          {phase === 'failed' && (
            <>
              <Link to="/app" className={ghostButtonClass}>
                your nuclei
              </Link>
              <GhostButton onClick={onBack}>edit songs</GhostButton>
              <PrimaryButton onClick={run}>try again</PrimaryButton>
            </>
          )}
          {done && needsAi && (
            <PrimaryButton onClick={() => startOpenRouterConnect('/start?step=forming')}>connect openrouter</PrimaryButton>
          )}
          {done && nucleusId !== null && (
            <Link
              to="/app/n/$nucleusId"
              params={{ nucleusId: String(nucleusId) }}
              className={needsAi ? ghostButtonClass : primaryButtonClass}
            >
              open your nucleus →
            </Link>
          )}
          {!done && phase !== 'failed' && (
            <GhostButton disabled>{phase === 'naming' ? 'naming...' : 'forming...'}</GhostButton>
          )}
        </div>
      </div>
    </div>
  )
}
