// "connect apple music": sign in with Apple, pick one of your playlists (Replay first), and its
// songs go into the import box. A Google account keeps the connection, so other devices skip the
// sign-in; a guest's stays in this browser. Hidden when Apple Music isn't set up on the server.
import { useEffect, useMemo, useState } from 'react'
import {
  AppleMusicReconnect,
  AppleMusicUnavailable,
  connectAppleMusic,
  disconnectAppleMusic,
  isAppleMusicSaved,
  isSuggestedPlaylist,
  listLibraryPlaylists,
  playlistImportInput,
  prepareMusicKit,
  type LibraryPlaylist,
  type MusicKitInstance,
} from '../lib/apple-music-client'

function friendlyError(error: unknown): string {
  if (error instanceof AppleMusicReconnect) return 'Apple Music needs you to connect again.'
  const message = error instanceof Error ? error.message : String(error)
  if (/AUTHORIZATION_ERROR|Unauthorized|cancel/i.test(message)) return 'Apple Music sign-in was cancelled or failed. Try again.'
  return message || 'Something went wrong with Apple Music. Try again.'
}

// MusicKit (for signing in) and whether the account already has Apple Music saved
function useAppleMusic() {
  const [music, setMusic] = useState<MusicKitInstance | null>(null)
  const [status, setStatus] = useState<'loading' | 'hidden' | 'ready'>('loading')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([prepareMusicKit(), isAppleMusicSaved().catch(() => false)])
      .then(([instance, isSaved]) => {
        if (cancelled) return
        setMusic(instance)
        setSaved(isSaved)
        setStatus('ready')
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof AppleMusicUnavailable) setStatus('hidden')
        else {
          setError(friendlyError(err))
          setStatus('ready')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const connected = saved || Boolean(music?.isAuthorized)
  return { music, setMusic, status, saved, setSaved, connected, error, setError }
}

interface AppleMusicConnectProps {
  // Called with the import lines for the playlist the person picked
  onPick: (input: string, playlistName: string, songCount: number) => void
  className?: string
}

type View = { kind: 'button' } | { kind: 'connecting' } | { kind: 'playlists'; playlists: LibraryPlaylist[]; reading: string | null }

export function AppleMusicConnect({ onPick, className = '' }: AppleMusicConnectProps) {
  const { music, setMusic, status, saved, setSaved, connected, error, setError } = useAppleMusic()
  const [view, setView] = useState<View>({ kind: 'button' })
  const [filter, setFilter] = useState('')

  const open = async () => {
    setError(null)
    setView({ kind: 'connecting' })
    try {
      const instance = music ?? (await prepareMusicKit())
      setMusic(instance)
      // Signs in with Apple when needed (first thing in the click, so the window isn't blocked), and
      // saves a browser-only connection to the account
      if (!saved) setSaved((await connectAppleMusic(instance)).saved)
      setView({ kind: 'playlists', playlists: await listLibraryPlaylists(instance), reading: null })
    } catch (err) {
      if (err instanceof AppleMusicReconnect) setSaved(false)
      setError(friendlyError(err))
      setView({ kind: 'button' })
    }
  }

  const pick = async (playlist: LibraryPlaylist, playlists: LibraryPlaylist[]) => {
    setError(null)
    setView({ kind: 'playlists', playlists, reading: playlist.id })
    try {
      const { input, count } = await playlistImportInput(music, playlist.id)
      if (count === 0) setError(`"${playlist.name}" has no songs Crosstalk can read.`)
      else onPick(input, playlist.name, count)
      setView({ kind: 'playlists', playlists, reading: null })
    } catch (err) {
      if (err instanceof AppleMusicReconnect) {
        setSaved(false)
        setView({ kind: 'button' })
      } else setView({ kind: 'playlists', playlists, reading: null })
      setError(friendlyError(err))
    }
  }

  const disconnect = async () => {
    await disconnectAppleMusic(music).catch(() => {})
    setSaved(false)
    setFilter('')
    setView({ kind: 'button' })
  }

  const playlists = view.kind === 'playlists' ? view.playlists : []
  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase()
    return term ? playlists.filter((p) => p.name.toLowerCase().includes(term)) : playlists
  }, [playlists, filter])

  if (status !== 'ready') return null

  return (
    <div className={`font-mono text-[11px] ${className}`}>
      {view.kind !== 'playlists' && (
        <button
          onClick={open}
          disabled={view.kind === 'connecting'}
          className="border border-white/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-white/80 transition-colors hover:border-white hover:text-white disabled:text-white/40"
        >
          {view.kind === 'connecting' ? 'connecting...' : connected ? 'pick an apple music playlist' : 'connect apple music'}
        </button>
      )}

      {view.kind === 'playlists' && (
        <div className="border border-white/25">
          <div className="flex items-center gap-2 border-b border-white/15 px-3 py-2">
            <span className="text-[10px] uppercase tracking-[0.18em] text-white/50">your apple music playlists</span>
            <button onClick={disconnect} className="ml-auto text-[10px] uppercase tracking-[0.15em] text-white/40 hover:text-white">
              disconnect
            </button>
          </div>
          {playlists.length > 8 && (
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="search your playlists"
              className="w-full border-b border-white/15 bg-transparent px-3 py-2 text-[11px] text-white placeholder-white/30 focus:outline-none"
              aria-label="Search your playlists"
            />
          )}
          <ul className="max-h-56 overflow-y-auto">
            {visible.length === 0 && <li className="px-3 py-3 text-white/45">No playlists found in your library.</li>}
            {visible.map((playlist) => (
              <li key={playlist.id}>
                <button
                  onClick={() => pick(playlist, playlists)}
                  disabled={view.reading !== null}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-white/[0.06] disabled:opacity-60"
                >
                  {playlist.artworkUrl ? (
                    <img src={playlist.artworkUrl} alt="" className="h-8 w-8 shrink-0 object-cover" />
                  ) : (
                    <span className="h-8 w-8 shrink-0 border border-white/20" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-white/85">{playlist.name}</span>
                  {view.reading === playlist.id ? (
                    <span className="shrink-0 text-[10px] text-white/50">reading...</span>
                  ) : (
                    isSuggestedPlaylist(playlist.name) && (
                      <span className="shrink-0 text-[9px] uppercase tracking-[0.15em] text-white/40">most honest</span>
                    )
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="mt-2 text-white/60">{error}</p>}
    </div>
  )
}

// The profile's "apple music" block: connect or disconnect without importing anything yet
export function AppleMusicStatus() {
  const { music, setMusic, status, saved, setSaved, connected, error, setError } = useAppleMusic()
  const [busy, setBusy] = useState(false)

  const toggle = async () => {
    setError(null)
    setBusy(true)
    try {
      const instance = music ?? (await prepareMusicKit())
      setMusic(instance)
      if (connected) {
        await disconnectAppleMusic(instance)
        setSaved(false)
      } else {
        setSaved((await connectAppleMusic(instance)).saved)
      }
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading') return <p className="text-xs text-white/40">loading...</p>
  if (status === 'hidden') return <p className="text-[13px] text-white/50">Apple Music isn't available yet.</p>

  return (
    <div className="space-y-3 text-[13px] leading-relaxed text-white/70">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-white">{saved ? 'connected to your account' : connected ? 'connected in this browser' : 'not connected'}</p>
        <button
          onClick={toggle}
          disabled={busy}
          className={
            connected
              ? 'border border-white/30 px-4 py-2 text-[11px] uppercase tracking-[0.12em] hover:border-white disabled:opacity-40'
              : 'bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-black hover:bg-white/85 disabled:opacity-40'
          }
        >
          {busy ? 'one moment...' : connected ? 'disconnect' : 'connect apple music'}
        </button>
      </div>
      <p className="text-[12px] text-white/50">
        {saved
          ? 'Pick a playlist (your Replay works best) from "add songs" in any nucleus, on any device. Crosstalk keeps your Apple Music sign-in encrypted and only reads your playlists.'
          : connected
            ? 'Save your nucleus with Google to keep Apple Music connected on your other devices too.'
            : 'Connect it to add songs straight from your playlists, like your Replay.'}
      </p>
      {error && <p className="text-[12px] text-white/60">{error}</p>}
    </div>
  )
}
