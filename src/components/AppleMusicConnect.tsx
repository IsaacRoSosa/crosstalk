// "connect apple music": sign in with Apple, pick one of your playlists (Replay first), and its
// songs go into the import box. Hidden when Apple Music isn't set up on the server.
import { useEffect, useMemo, useState } from 'react'
import {
  AppleMusicUnavailable,
  isSuggestedPlaylist,
  listLibraryPlaylists,
  playlistImportInput,
  prepareMusicKit,
  type LibraryPlaylist,
  type MusicKitInstance,
} from '../lib/apple-music-client'

interface AppleMusicConnectProps {
  // Called with the import lines for the playlist the person picked
  onPick: (input: string, playlistName: string, songCount: number) => void
  className?: string
}

type State =
  | { kind: 'loading' }
  | { kind: 'hidden' }
  | { kind: 'ready' }
  | { kind: 'connecting' }
  | { kind: 'playlists'; playlists: LibraryPlaylist[] }
  | { kind: 'reading'; playlists: LibraryPlaylist[]; name: string }

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/AUTHORIZATION_ERROR|Unauthorized|cancel/i.test(message)) return 'Apple Music sign-in was cancelled or failed. Try again.'
  if (/403|subscription/i.test(message)) return 'Apple Music needs an active subscription to read your library. Try reconnecting.'
  return message || 'Something went wrong with Apple Music. Try again.'
}

export function AppleMusicConnect({ onPick, className = '' }: AppleMusicConnectProps) {
  const [music, setMusic] = useState<MusicKitInstance | null>(null)
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let cancelled = false
    prepareMusicKit()
      .then((instance) => {
        if (cancelled) return
        setMusic(instance)
        setState({ kind: 'ready' })
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof AppleMusicUnavailable) setState({ kind: 'hidden' })
        else {
          setState({ kind: 'ready' })
          setError(friendlyError(err))
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const connect = async () => {
    setError(null)
    setState({ kind: 'connecting' })
    try {
      const instance = music ?? (await prepareMusicKit())
      setMusic(instance)
      if (!instance.isAuthorized) await instance.authorize()
      const playlists = await listLibraryPlaylists(instance)
      setState({ kind: 'playlists', playlists })
    } catch (err) {
      setError(friendlyError(err))
      setState({ kind: 'ready' })
    }
  }

  const pick = async (playlist: LibraryPlaylist, playlists: LibraryPlaylist[]) => {
    if (!music) return
    setError(null)
    setState({ kind: 'reading', playlists, name: playlist.name })
    try {
      const { input, count } = await playlistImportInput(music, playlist.id)
      if (count === 0) {
        setError(`"${playlist.name}" has no songs Crosstalk can read.`)
        setState({ kind: 'playlists', playlists })
        return
      }
      onPick(input, playlist.name, count)
      setState({ kind: 'playlists', playlists })
    } catch (err) {
      setError(friendlyError(err))
      setState({ kind: 'playlists', playlists })
    }
  }

  const disconnect = async () => {
    await music?.unauthorize().catch(() => {})
    setFilter('')
    setState({ kind: 'ready' })
  }

  const playlists = state.kind === 'playlists' || state.kind === 'reading' ? state.playlists : []
  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase()
    return term ? playlists.filter((p) => p.name.toLowerCase().includes(term)) : playlists
  }, [playlists, filter])

  if (state.kind === 'hidden' || state.kind === 'loading') return null

  return (
    <div className={`font-mono text-[11px] ${className}`}>
      {(state.kind === 'ready' || state.kind === 'connecting') && (
        <button
          onClick={connect}
          disabled={state.kind === 'connecting'}
          className="border border-white/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-white/80 transition-colors hover:border-white hover:text-white disabled:text-white/40"
        >
          {state.kind === 'connecting' ? 'connecting...' : 'connect apple music'}
        </button>
      )}

      {(state.kind === 'playlists' || state.kind === 'reading') && (
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
            {visible.map((playlist) => {
              const busy = state.kind === 'reading' && state.name === playlist.name
              return (
                <li key={playlist.id}>
                  <button
                    onClick={() => pick(playlist, playlists)}
                    disabled={state.kind === 'reading'}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-white/[0.06] disabled:opacity-60"
                  >
                    {playlist.artworkUrl ? (
                      <img src={playlist.artworkUrl} alt="" className="h-8 w-8 shrink-0 object-cover" />
                    ) : (
                      <span className="h-8 w-8 shrink-0 border border-white/20" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-white/85">{playlist.name}</span>
                    {busy ? (
                      <span className="shrink-0 text-[10px] text-white/50">reading...</span>
                    ) : (
                      isSuggestedPlaylist(playlist.name) && (
                        <span className="shrink-0 text-[9px] uppercase tracking-[0.15em] text-white/40">most honest</span>
                      )
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {error && <p className="mt-2 text-white/60">{error}</p>}
    </div>
  )
}
