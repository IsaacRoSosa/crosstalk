import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Music, Sparkles, Plus, Trash2, ChevronDown, ChevronUp, Pause, Play, Volume2, X, PanelRightOpen, PanelRightClose, ArrowLeft, Orbit, List, SkipBack, SkipForward, Shuffle } from 'lucide-react'
import { NucleusVisualization } from '../../../components/NucleusVisualization'
import type { NucleusVisualizationHandle } from '../../../components/NucleusVisualization'
import { NucleusChat } from '../../../components/NucleusChat'
import { AiConnectionPanel } from '../../../components/AiConnectionPanel'
import { AccountPanel } from '../../../components/AccountPanel'
import { ImpressionCard } from '../../../components/ImpressionCard'
import { ShareButton } from '../../../components/ShareButton'
import { TrackListView, songSignals, type NucleusOption, type TransferTarget } from '../../../components/TrackListView'
import { PulseDot, primaryButtonClass } from '../../../components/ui'
import type { Track } from '../../../types/track'
import { MAX_NUCLEI } from '../../../types/nucleus'
import { apiFetch } from '../../../lib/api-client'
import { saveWithGoogle } from '../../../lib/auth'
import { isEmptyImport, parseImportInput } from '../../../lib/import-input'
import { importSongs, type ImportProgress } from '../../../lib/import-client'
import {
  ApiError,
  createNucleus,
  getNucleus,
  listNuclei,
  listTracks,
  readNucleus,
  removeTracks,
  renameNucleus as renameNucleusRequest,
  transferTracks,
} from '../../../lib/nuclei-client'
import '../../../styles/galaxy.css'

// YouTube IFrame API types
interface YTPlayer {
  playVideo: () => void
  pauseVideo: () => void
  destroy: () => void
  getPlayerState: () => number
  getCurrentTime: () => number
  getDuration: () => number
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
}

declare global {
  interface Window {
    YT: {
      Player: new (elementId: string, config: {
        height: string
        width: string
        videoId: string
        playerVars?: Record<string, number | string>
        events?: Record<string, (event: { data: number; target: YTPlayer }) => void>
      }) => YTPlayer
      PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; BUFFERING: number }
    }
    onYouTubeIframeAPIReady: () => void
  }
}

interface OrbitInfo {
  orbitIndex: number
  tracks: Track[]
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

type View = 'galaxy' | 'list'

export const Route = createFileRoute('/app/n/$nucleusId')({
  component: NucleusPage,
  validateSearch: (search: Record<string, unknown>): { view?: View } => (search.view === 'list' ? { view: 'list' } : {}),
})

// Remounts the page when moving between nuclei, so no state (tracks, chat, selection) leaks across
function NucleusPage() {
  const { nucleusId } = Route.useParams()
  return <NucleusScreen key={nucleusId} nucleusId={Number(nucleusId)} />
}

function NucleusScreen({ nucleusId }: { nucleusId: number }) {
  const navigate = useNavigate()
  const view: View = Route.useSearch().view ?? 'galaxy'
  const setView = (next: View) =>
    navigate({ to: '/app/n/$nucleusId', params: { nucleusId: String(nucleusId) }, search: next === 'list' ? { view: 'list' } : {}, replace: true })

  const [notFound, setNotFound] = useState(false)
  const [isAnonymous, setIsAnonymous] = useState(true)
  const [otherNuclei, setOtherNuclei] = useState<NucleusOption[]>([])
  const [nucleusCount, setNucleusCount] = useState(1)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [importInput, setImportInput] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  // Bumped when the server says the AI isn't connected, so the panel re-checks and stands out
  const [aiPanelRefresh, setAiPanelRefresh] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Live progress while songs are added: which one is being read and how many are done
  const [playlistProgress, setPlaylistProgress] = useState<{
    processed: number
    total: number
    song: string | null
    stage: string | null
  } | null>(null)
  const [nucleusName, setNucleusName] = useState('The Nucleus')
  const [impression, setImpression] = useState<{ text: string | null; trackCount: number | null }>({ text: null, trackCount: null })
  const [isReading, setIsReading] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null)
  const [selectedOrbit, setSelectedOrbit] = useState<number | null>(null)
  const [trackScreenPos, setTrackScreenPos] = useState<{ x: number; y: number } | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null)
  const [isTooltipReady, setIsTooltipReady] = useState(false)
  const [nucleusScreenPos, setNucleusScreenPos] = useState<{ x: number; y: number } | null>(null)
  const [nucleusChatPosition, setNucleusChatPosition] = useState<{ x: number; y: number } | null>(null)
  const [isNucleusChatReady, setIsNucleusChatReady] = useState(false)

  const visualizationRef = useRef<NucleusVisualizationHandle>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const nucleusChatRef = useRef<HTMLDivElement>(null)

  // YouTube audio playback state
  const [playingTrack, setPlayingTrack] = useState<Track | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoadingVideo, setIsLoadingVideo] = useState(false)
  const [showSwitchConfirm, setShowSwitchConfirm] = useState(false)
  const [seekProgress, setSeekProgress] = useState(0)
  const [seekDuration, setSeekDuration] = useState(0)
  const seekIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const ytPlayerRef = useRef<YTPlayer | null>(null)
  const ytApiReady = useRef(false)
  const ytApiCallbacks = useRef<(() => void)[]>([])

  // Play queue: playing a song continues through the rest of the list it was started from
  const queueRef = useRef<Track[]>([])
  // Galaxy order (newest first), for queues started from the galaxy
  const sortedTracksRef = useRef<Track[]>([])
  const queueOrderRef = useRef<Track[]>([])
  const queueIndexRef = useRef(0)
  const [queueInfo, setQueueInfo] = useState<{ index: number; length: number } | null>(null)
  const [shuffle, setShuffle] = useState(false)
  const shuffleRef = useRef(false)
  // Called when a song ends or can't be played; set below once the queue functions exist
  const advanceRef = useRef<(() => void) | null>(null)
  // Consecutive songs skipped because no playable video was found, to stop instead of looping forever
  const skippedInARow = useRef(0)
  const stopPlaybackRef = useRef<() => void>(() => {})

  // Load YouTube IFrame API
  useEffect(() => {
    const markReady = () => {
      ytApiReady.current = true
      ytApiCallbacks.current.forEach(cb => cb())
      ytApiCallbacks.current = []
    }

    if (window.YT && window.YT.Player) {
      markReady()
      return
    }

    // Set the callback even if the script tag already exists (e.g. after navigating away and back
    // before it finished loading); otherwise queued plays would never start
    window.onYouTubeIframeAPIReady = markReady

    if (!document.getElementById('yt-iframe-api')) {
      const tag = document.createElement('script')
      tag.id = 'yt-iframe-api'
      tag.src = 'https://www.youtube.com/iframe_api'
      tag.onerror = () => console.error('Could not load the YouTube player (blocked by the browser or an extension?)')
      document.head.appendChild(tag)
    }
  }, [])

  const searchYouTubeVideo = useCallback(async (track: Track): Promise<string | null> => {
    try {
      const response = await apiFetch('/api/tracks/video', {
        method: 'POST',
        body: JSON.stringify({ trackId: track.id }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Video lookup failed')
      }
      return result.videoId || null
    } catch (err) {
      console.error('YouTube search failed:', err)
      throw err
    }
  }, [])

  const createYTPlayer = useCallback((videoId: string, track: Track) => {
    // Destroy existing player
    if (ytPlayerRef.current) {
      ytPlayerRef.current.destroy()
      ytPlayerRef.current = null
    }

    // Ensure container exists
    let container = document.getElementById('yt-player-container')
    if (!container) {
      container = document.createElement('div')
      container.id = 'yt-player-container'
      container.style.position = 'fixed'
      container.style.top = '-9999px'
      container.style.left = '-9999px'
      container.style.width = '1px'
      container.style.height = '1px'
      container.style.overflow = 'hidden'
      document.body.appendChild(container)
    }

    // Clear and recreate the player div
    container.innerHTML = '<div id="yt-player"></div>'

    const player = new window.YT.Player('yt-player', {
      height: '1',
      width: '1',
      videoId,
      playerVars: {
        autoplay: 1,
        controls: 0,
        disablekb: 1,
        fs: 0,
        modestbranding: 1,
        rel: 0,
      },
      events: {
        onReady: (event) => {
          event.target.playVideo()
        },
        onStateChange: (event) => {
          if (event.data === window.YT.PlayerState.PLAYING) {
            setIsPlaying(true)
            setIsLoadingVideo(false)
            // Start polling progress
            if (seekIntervalRef.current) clearInterval(seekIntervalRef.current)
            seekIntervalRef.current = setInterval(() => {
              if (ytPlayerRef.current) {
                setSeekProgress(ytPlayerRef.current.getCurrentTime())
                setSeekDuration(ytPlayerRef.current.getDuration())
              }
            }, 500)
          } else if (event.data === window.YT.PlayerState.PAUSED) {
            setIsPlaying(false)
            if (seekIntervalRef.current) clearInterval(seekIntervalRef.current)
          } else if (event.data === window.YT.PlayerState.ENDED) {
            skippedInARow.current = 0
            if (advanceRef.current) advanceRef.current()
            else event.target.playVideo()
          }
        },
        // e.g. the video can't be embedded: move on to the next song
        onError: () => {
          skippedInARow.current++
          advanceRef.current?.()
        },
      },
    })

    ytPlayerRef.current = player
    setPlayingTrack(track)
  }, [])

  // 'missing' means YouTube has no video for it (a queue skips it); 'error' means lookups are failing
  // altogether, e.g. the daily YouTube quota is used up (a queue stops)
  const playTrack = useCallback(async (track: Track): Promise<'playing' | 'missing' | 'error'> => {
    setIsLoadingVideo(true)
    setPlayingTrack(track)

    let videoId: string | null
    try {
      videoId = await searchYouTubeVideo(track)
    } catch (err) {
      setIsLoadingVideo(false)
      setError(err instanceof Error ? err.message : 'Could not play this track')
      return 'error'
    }
    if (!videoId) {
      setIsLoadingVideo(false)
      setError(`Couldn't find ${track.title} on YouTube`)
      return 'missing'
    }

    const doCreate = () => createYTPlayer(videoId, track)

    if (ytApiReady.current) {
      doCreate()
    } else {
      ytApiCallbacks.current.push(doCreate)
    }
    return 'playing'
  }, [searchYouTubeVideo, createYTPlayer])

  const playAt = useCallback(
    async (index: number) => {
      const queue = queueRef.current
      if (index < 0 || index >= queue.length) return
      queueIndexRef.current = index
      setQueueInfo({ index, length: queue.length })
      const outcome = await playTrack(queue[index])
      if (outcome === 'missing' && skippedInARow.current < 3 && index + 1 < queue.length) {
        skippedInARow.current++
        playAt(index + 1)
      } else if (outcome !== 'playing') {
        stopPlaybackRef.current()
      }
    },
    [playTrack],
  )

  const shuffled = (list: Track[]) => {
    const copy = [...list]
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy
  }

  // Plays `list` starting at `startIndex`, then carries on through the rest of it
  const playQueue = useCallback(
    (list: Track[], startIndex: number) => {
      if (!list[startIndex]) return
      queueOrderRef.current = list
      const first = list[startIndex]
      queueRef.current = shuffleRef.current ? [first, ...shuffled(list.filter((t) => t.id !== first.id))] : list
      skippedInARow.current = 0
      playAt(shuffleRef.current ? 0 : startIndex)
    },
    [playAt],
  )

  const skip = useCallback(
    (delta: number) => {
      const next = queueIndexRef.current + delta
      if (next >= 0 && next < queueRef.current.length) playAt(next)
    },
    [playAt],
  )

  // Shuffling keeps the current song and reorders what's left; turning it off goes back to list order
  const toggleShuffle = () => {
    const on = !shuffleRef.current
    shuffleRef.current = on
    setShuffle(on)
    const queue = queueRef.current
    if (queue.length === 0) return
    const current = queue[queueIndexRef.current]
    if (on) {
      queueRef.current = [...queue.slice(0, queueIndexRef.current + 1), ...shuffled(queue.slice(queueIndexRef.current + 1))]
    } else {
      queueRef.current = queueOrderRef.current
      queueIndexRef.current = Math.max(0, queueOrderRef.current.findIndex((t) => t.id === current?.id))
    }
    setQueueInfo({ index: queueIndexRef.current, length: queueRef.current.length })
  }

  const togglePlayback = useCallback(() => {
    if (!ytPlayerRef.current) return
    if (isPlaying) {
      ytPlayerRef.current.pauseVideo()
      setIsPlaying(false)
    } else {
      ytPlayerRef.current.playVideo()
      setIsPlaying(true)
    }
  }, [isPlaying])

  const stopPlayback = useCallback(() => {
    queueRef.current = []
    setQueueInfo(null)
    if (seekIntervalRef.current) clearInterval(seekIntervalRef.current)
    if (ytPlayerRef.current) {
      ytPlayerRef.current.destroy()
      ytPlayerRef.current = null
    }
    setPlayingTrack(null)
    setIsPlaying(false)
    setSeekProgress(0)
    setSeekDuration(0)
  }, [])

  stopPlaybackRef.current = stopPlayback
  // The end of the queue stops playback
  advanceRef.current = () => {
    if (queueIndexRef.current + 1 < queueRef.current.length && skippedInARow.current < 3) skip(1)
    else stopPlayback()
  }

  const confirmTrackChange = useCallback(() => {
    if (selectedTrack) {
      playQueue(sortedTracksRef.current, Math.max(0, sortedTracksRef.current.findIndex((t) => t.id === selectedTrack.id)))
      setShowSwitchConfirm(false)
      // Keep modal open - don't close it
    }
  }, [selectedTrack, playQueue])

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value)
    setSeekProgress(time)
    if (ytPlayerRef.current) {
      ytPlayerRef.current.seekTo(time, true)
    }
  }, [])

  // Cleanup YouTube player on unmount
  useEffect(() => {
    return () => {
      if (seekIntervalRef.current) clearInterval(seekIntervalRef.current)
      if (ytPlayerRef.current) {
        ytPlayerRef.current.destroy()
      }
    }
  }, [])

  // Track the tooltip's center position
  useEffect(() => {
    if (!selectedTrack) {
      setIsTooltipReady(false)
      setTooltipPosition(null)
      return
    }

    // Wait for tooltip to be rendered and positioned
    const timeoutId = setTimeout(() => {
      if (tooltipRef.current) {
        const rect = tooltipRef.current.getBoundingClientRect()
        setTooltipPosition({
          x: rect.left,
          y: rect.top + rect.height / 2,
        })
        setIsTooltipReady(true)
      }
    }, 50)

    const updateTooltipPosition = () => {
      if (tooltipRef.current) {
        const rect = tooltipRef.current.getBoundingClientRect()
        setTooltipPosition({
          x: rect.left,
          y: rect.top + rect.height / 2,
        })
      }
    }

    // Update on resize
    window.addEventListener('resize', updateTooltipPosition)

    return () => {
      clearTimeout(timeoutId)
      window.removeEventListener('resize', updateTooltipPosition)
    }
  }, [selectedTrack])

  // Track the selected track's screen position
  useEffect(() => {
    if (!selectedTrack) {
      setTrackScreenPos(null)
      return
    }

    let animationFrameId: number

    const updatePosition = () => {
      if (visualizationRef.current && selectedTrack) {
        const pos = visualizationRef.current.getTrackScreenPosition(selectedTrack.id)
        setTrackScreenPos(pos)
      }
      animationFrameId = requestAnimationFrame(updatePosition)
    }

    updatePosition()

    return () => {
      cancelAnimationFrame(animationFrameId)
    }
  }, [selectedTrack])

  // Track nucleus screen position when chat is open
  useEffect(() => {
    if (!isChatOpen) {
      setNucleusScreenPos(null)
      return
    }

    let animationFrameId: number

    const updatePosition = () => {
      if (visualizationRef.current) {
        const pos = visualizationRef.current.getNucleusScreenPosition()
        setNucleusScreenPos(pos)
      }
      animationFrameId = requestAnimationFrame(updatePosition)
    }

    updatePosition()

    return () => {
      cancelAnimationFrame(animationFrameId)
    }
  }, [isChatOpen])

  // Track the nucleus chat popup position
  useEffect(() => {
    if (!isChatOpen) {
      setIsNucleusChatReady(false)
      setNucleusChatPosition(null)
      return
    }

    const timeoutId = setTimeout(() => {
      if (nucleusChatRef.current) {
        const rect = nucleusChatRef.current.getBoundingClientRect()
        setNucleusChatPosition({
          x: rect.left,
          y: rect.top + rect.height / 2,
        })
        setIsNucleusChatReady(true)
      }
    }, 50)

    const updateChatPosition = () => {
      if (nucleusChatRef.current) {
        const rect = nucleusChatRef.current.getBoundingClientRect()
        setNucleusChatPosition({
          x: rect.left,
          y: rect.top + rect.height / 2,
        })
      }
    }

    window.addEventListener('resize', updateChatPosition)

    return () => {
      clearTimeout(timeoutId)
      window.removeEventListener('resize', updateChatPosition)
    }
  }, [isChatOpen])

  // Track card expansion state
  const [expandedTracks, setExpandedTracks] = useState<Set<number>>(new Set())

  const toggleTrackExpanded = (trackId: number) => {
    setExpandedTracks(prev => {
      const next = new Set(prev)
      if (next.has(trackId)) {
        next.delete(trackId)
      } else {
        next.add(trackId)
      }
      return next
    })
  }

  useEffect(() => {
    loadTracks()
    loadNucleus()
    loadLibrary()
  }, [])

  const loadTracks = async () => {
    try {
      const data = await listTracks(nucleusId)
      setTracks(data.tracks)
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) setNotFound(true)
      else console.error('Failed to load tracks:', error)
    }
  }

  const loadNucleus = async () => {
    try {
      const data = await getNucleus(nucleusId)
      setNucleusName(data.nucleus.name)
      setImpression({ text: data.nucleus.impression, trackCount: data.nucleus.impression_track_count })
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) setNotFound(true)
      else console.error('Failed to load nucleus:', error)
    }
  }

  // The user's other nuclei, as places to move or copy songs to
  const loadLibrary = async () => {
    try {
      const data = await listNuclei()
      setIsAnonymous(data.isAnonymous)
      setNucleusCount(data.nuclei.length)
      setOtherNuclei(data.nuclei.filter((n) => n.id !== nucleusId).map(({ id, name, trackCount }) => ({ id, name, trackCount })))
    } catch (error) {
      console.error('Failed to load nuclei:', error)
    }
  }

  const saveName = async () => {
    const name = editingName?.trim()
    setEditingName(null)
    if (!name || name === nucleusName) return
    const previous = nucleusName
    setNucleusName(name)
    try {
      await renameNucleusRequest(nucleusId, name)
    } catch (error) {
      setNucleusName(previous)
      setError(error instanceof Error ? error.message : 'Could not rename the nucleus')
    }
  }

  const handleRemoveTracks = async (trackIds: number[]) => {
    await removeTracks(nucleusId, trackIds)
    const removed = new Set(trackIds)
    setTracks((prev) => prev.filter((t) => !removed.has(t.id)))
    if (playingTrack && removed.has(playingTrack.id)) stopPlayback()
  }

  const handleTransfer = async (trackIds: number[], target: TransferTarget, mode: 'copy' | 'move'): Promise<string> => {
    let targetId: number
    let targetName: string
    if ('newName' in target) {
      const created = await createNucleus({ name: target.newName })
      targetId = created.nucleus.id
      targetName = created.nucleus.name
    } else {
      targetId = target.nucleusId
      targetName = otherNuclei.find((n) => n.id === targetId)?.name ?? 'the other nucleus'
    }

    const result = await transferTracks(nucleusId, targetId, trackIds, mode)
    if (mode === 'move') {
      const moved = new Set(trackIds)
      setTracks((prev) => prev.filter((t) => !moved.has(t.id)))
      if (playingTrack && moved.has(playingTrack.id)) stopPlayback()
    }
    await loadLibrary()

    const verb = mode === 'move' ? 'moved' : 'copied'
    const count = trackIds.length
    const already = result.alreadyThere > 0 ? ` (${result.alreadyThere} were already there)` : ''
    return `${verb} ${count} song${count === 1 ? '' : 's'} to ${targetName.toLowerCase()}${already}`
  }

  const addTrack = async () => {
    const input = importInput.trim()
    if (!input) return

    const parsed = parseImportInput(input)
    if (isEmptyImport(parsed)) {
      setError('Paste Spotify song links, or a Deezer or Apple Music playlist link.')
      return
    }

    // Single songs are added without the progress bar or a summary
    const songCount = parsed.spotifyTrackIds.length + parsed.deezerTrackIds.length + parsed.appleMusicSongs.length
    const isBatch =
      songCount > 1 ||
      parsed.deezerPlaylistIds.length > 0 ||
      parsed.deezerShortLinks.length > 0 ||
      parsed.appleMusicPlaylists.length > 0
    const previousCount = tracks.length

    setIsAnalyzing(true)
    setError(null)
    setPlaylistProgress(null)

    // Follow the import song by song; added songs enter orbit right away
    setPlaylistProgress({ processed: 0, total: Math.max(1, songCount), song: null, stage: null })
    const onProgress = (progress: ImportProgress) => {
      switch (progress.type) {
        case 'start':
          setPlaylistProgress((prev) => prev && { ...prev, total: Math.max(1, progress.total) })
          break
        case 'song':
          setPlaylistProgress((prev) =>
            prev && { ...prev, song: `${progress.title} · ${progress.artist}`, stage: progress.cached ? 'already read' : 'looking up' },
          )
          break
        case 'stage':
          setPlaylistProgress((prev) => prev && { ...prev, stage: progress.stage === 'lyrics' ? 'finding lyrics' : 'reading the mood' })
          break
        case 'added':
          setTracks((prev) => [progress.track, ...prev.filter((t) => t.id !== progress.track.id)])
          setPlaylistProgress((prev) => prev && { ...prev, processed: prev.processed + 1 })
          break
        case 'skipped':
        case 'failed':
          setPlaylistProgress((prev) => prev && { ...prev, processed: prev.processed + 1 })
          break
      }
    }

    try {
      const data = await importSongs(nucleusId, input, onProgress)

      await loadTracks()
      setImportInput('')

      if (isBatch || data.successCount === 0) {
        const summary: string[] = []
        if (data.successCount > 0) summary.push(`✓ ${data.successCount} added`)
        if (data.skippedCount > 0) summary.push(`○ ${data.skippedCount} already in collection`)
        if (data.failedCount > 0) {
          summary.push(data.failedCount === 1 && !isBatch ? `✗ ${data.failed[0].reason}` : `✗ ${data.failedCount} failed (no lyrics or errors)`)
        }
        if (data.notice) summary.push(data.notice)
        setError(summary.join(' • '))
      }
      if (data.aiError) {
        setAiPanelRefresh(n => n + 1)
      }

      // Read the nucleus again when it's new, or each time it passes a multiple of 10 songs
      // (each read is one of the user's free AI requests)
      const newCount = previousCount + data.successCount
      if (data.successCount > 0 && !data.aiError && (impression.text === null || Math.floor(newCount / 10) > Math.floor(previousCount / 10))) {
        await refreshRead()
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error')
    } finally {
      setIsAnalyzing(false)
      setPlaylistProgress(null)
    }
  }

  const deleteTrack = async (id: number) => {
    try {
      await handleRemoveTracks([id])
    } catch (error) {
      console.error('Failed to delete track:', error)
    }
  }

  const refreshRead = async () => {
    setIsReading(true)
    setReadError(null)
    try {
      const data = await readNucleus(nucleusId)
      setNucleusName(data.name)
      setImpression({ text: data.impression, trackCount: data.impressionTrackCount })
    } catch (error) {
      setReadError(error instanceof Error ? error.message : 'Could not read this nucleus')
      if (error instanceof ApiError && error.code === 'ai_not_connected') setAiPanelRefresh((n) => n + 1)
    } finally {
      setIsReading(false)
    }
  }


  const handleOrbitClick = (orbitInfo: OrbitInfo | null) => {
    if (orbitInfo) {
      setSelectedOrbit(orbitInfo.orbitIndex)
    } else {
      setSelectedOrbit(null)
      setSelectedTrack(null)
      setShowSwitchConfirm(false)
      setIsChatOpen(false)
    }
  }

  const handleTrackClick = (track: Track) => {
    // If clicking the same track that's already selected, close the modal
    if (selectedTrack?.id === track.id) {
      setSelectedTrack(null)
      setShowSwitchConfirm(false)
      visualizationRef.current?.resetCamera()
      return
    }

    // Select the track and show modal
    setSelectedTrack(track)
    setShowSwitchConfirm(false)

    // Handle audio playback
    if (!playingTrack) {
      // Nothing playing - start here and carry on through the nucleus
      playQueue(sortedTracks, Math.max(0, sortedTracks.findIndex((t) => t.id === track.id)))
    } else if (playingTrack.id === track.id) {
      // Same track already playing - just show modal, don't toggle playback
      // User can use the player controls if they want to pause
    } else {
      // Different track playing - show switch confirmation in tooltip
      setShowSwitchConfirm(true)
    }
  }

  // Sort tracks by added_at (newest first)
  const sortedTracks = useMemo(() => {
    return [...tracks].sort((a, b) =>
      new Date(b.added_at).getTime() - new Date(a.added_at).getTime()
    )
  }, [tracks])
  sortedTracksRef.current = sortedTracks

  // Distribute tracks across orbits (newest = inner, oldest = outer)
  const tracksByOrbit = useMemo(() => {
    const orbits: Track[][] = Array(6).fill(null).map(() => [])
    const tracksPerOrbit = Math.ceil(sortedTracks.length / 6)

    sortedTracks.forEach((track, index) => {
      const orbitIndex = Math.min(Math.floor(index / Math.max(tracksPerOrbit, 1)), 5)
      orbits[orbitIndex].push(track)
    })

    return orbits
  }, [sortedTracks])

  // Filter tracks by selected orbit
  const filteredTracks = selectedOrbit !== null
    ? tracksByOrbit[selectedOrbit - 1] || []
    : sortedTracks

  const switchView = (next: View) => {
    setSelectedTrack(null)
    setShowSwitchConfirm(false)
    setIsChatOpen(false)
    setSelectedOrbit(null)
    setView(next)
  }

  const toggleChat = () => {
    const nextOpen = !isChatOpen
    setIsChatOpen(nextOpen)
    if (view !== 'galaxy') return
    if (nextOpen) {
      setSelectedTrack(null)
      setShowSwitchConfirm(false)
      visualizationRef.current?.zoomToNucleus()
    } else {
      visualizationRef.current?.resetCamera()
    }
  }

  if (notFound) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black px-6 text-center font-mono text-white">
        <PulseDot size={8} />
        <h1 className="text-lg font-semibold">this nucleus doesn't exist</h1>
        <p className="max-w-sm text-xs text-white/50">It may have been deleted, or it belongs to another account.</p>
        <Link to="/app" className={primaryButtonClass}>
          back to your nuclei
        </Link>
      </div>
    )
  }

  const canCreateNucleus = !isAnonymous && nucleusCount < MAX_NUCLEI

  return (
    <div className="nucleus-container">
      {/* Header: back to the library, the nucleus name (click to rename) and the view toggle */}
      <div
        className={`fixed left-4 top-4 z-50 flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-2 font-mono transition-[right] duration-300 ${
          sidebarCollapsed ? 'right-16' : 'right-16 md:right-[368px]'
        } pointer-events-none`}
      >
        <Link
          to="/app"
          className="pointer-events-auto flex h-8 items-center gap-1.5 border border-white/30 bg-black/80 px-2.5 text-[10px] uppercase tracking-[0.15em] text-white/60 hover:border-white/60 hover:text-white"
          title="All your nuclei"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> nuclei
        </Link>
        <div className="pointer-events-auto flex h-8 min-w-0 items-center border border-white/30 bg-black/80 px-2.5">
          {editingName !== null ? (
            <input
              autoFocus
              value={editingName}
              maxLength={80}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveName()
                if (e.key === 'Escape') setEditingName(null)
              }}
              className="w-48 bg-transparent text-xs text-white focus:outline-none"
              aria-label="Nucleus name"
            />
          ) : (
            <button
              onClick={() => setEditingName(nucleusName)}
              className="truncate text-xs font-semibold text-white hover:text-white/80"
              title="Rename"
            >
              {nucleusName.toLowerCase()}
            </button>
          )}
          <span className="ml-2 shrink-0 text-[10px] text-white/40">{tracks.length} songs</span>
        </div>
        <div className="pointer-events-auto flex h-8 border border-white/30 bg-black/80" role="group" aria-label="View">
          {(
            [
              ['galaxy', Orbit],
              ['list', List],
            ] as const
          ).map(([option, Icon]) => (
            <button
              key={option}
              onClick={() => switchView(option)}
              aria-pressed={view === option}
              className={`flex items-center gap-1.5 px-2.5 text-[10px] uppercase tracking-[0.15em] transition-colors ${
                view === option ? 'bg-white text-black' : 'text-white/60 hover:text-white'
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {option}
            </button>
          ))}
        </div>
        {view === 'galaxy' && tracks.length > 0 && !playingTrack && !isLoadingVideo && (
          <button
            onClick={() => playQueue(sortedTracks, 0)}
            className="pointer-events-auto flex h-8 items-center gap-1.5 border border-white/30 bg-black/80 px-2.5 text-[10px] uppercase tracking-[0.15em] text-white/60 hover:border-white/60 hover:text-white"
          >
            <Play className="h-3.5 w-3.5" /> play all
          </button>
        )}
        <button
          onClick={toggleChat}
          aria-pressed={isChatOpen}
          className={`pointer-events-auto flex h-8 items-center gap-1.5 border px-2.5 text-[10px] uppercase tracking-[0.15em] transition-colors ${
            isChatOpen ? 'border-white bg-white text-black' : 'border-white/30 bg-black/80 text-white/60 hover:border-white/60 hover:text-white'
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" /> talk to it
        </button>
        <ShareButton nucleusId={nucleusId} trackCount={tracks.length} />
      </div>

      {/* Sidebar toggle button */}
      <button
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        className="fixed top-4 right-4 z-50 w-8 h-8 flex items-center justify-center bg-black/80 border border-white/30 text-white/60 hover:text-white hover:border-white/60 transition-all"
        style={{ right: sidebarCollapsed ? 16 : `calc(320px + 16px)` }}
        title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
      >
        {sidebarCollapsed ? <PanelRightOpen className="w-4 h-4" /> : <PanelRightClose className="w-4 h-4" />}
      </button>

      {/* Galaxy or list, full screen minus sidebar width */}
      {view === 'list' ? (
        <div
          className={`fixed inset-0 overflow-y-auto bg-black transition-[right] duration-300 ${sidebarCollapsed ? 'right-0' : 'right-80'} ${
            playingTrack || isLoadingVideo ? 'pb-24' : 'pb-8'
          }`}
        >
          <div className="mx-auto max-w-5xl px-4 pt-20 sm:px-6">
<ImpressionCard
              impression={impression.text}
              readWithTracks={impression.trackCount}
              trackCount={tracks.length}
              busy={isReading}
              error={readError}
              onRead={refreshRead}
              className="mb-5"
            />
            <TrackListView
              tracks={tracks}
              otherNuclei={otherNuclei}
              canOrganize={!isAnonymous}
              canCreateNucleus={canCreateNucleus}
              playingTrackId={playingTrack?.id ?? null}
              isPlaying={isPlaying}
              onPlay={playQueue}
              onTogglePlayback={togglePlayback}
              onRemove={handleRemoveTracks}
              onTransfer={handleTransfer}
              onSaveWithGoogle={() => saveWithGoogle().catch((err) => setError(err instanceof Error ? err.message : 'Could not open Google'))}
            />
          </div>
        </div>
      ) : (
      <>
      {!selectedTrack && !isChatOpen && (
        <div className="fixed left-4 top-16 z-40 w-[min(380px,calc(100%-2rem))]">
          <ImpressionCard
            impression={impression.text}
            readWithTracks={impression.trackCount}
            trackCount={tracks.length}
            busy={isReading}
            error={readError}
            onRead={refreshRead}
          />
        </div>
      )}
      <div className={`fixed inset-0 transition-[right] duration-300 ${sidebarCollapsed ? 'right-0' : 'right-80'}`}>
        <NucleusVisualization
          ref={visualizationRef}
          tracks={tracks}
          onOrbitClick={handleOrbitClick}
          onTrackClick={handleTrackClick}
          onNucleusClick={toggleChat}
          isAudioPlaying={isPlaying}
          audioEnergy={playingTrack?.energy ?? undefined}
        />
      </div>
      </>
      )}

      {/* Sidebar */}
      <div className={`fixed top-0 w-80 h-screen bg-black border-l border-white/20 overflow-y-auto z-40 transition-[right] duration-300 ${sidebarCollapsed ? '-right-80' : 'right-0'}`}>
        <div className="pb-4 px-4 pt-4">
          <AccountPanel />
          <AiConnectionPanel refreshToken={aiPanelRefresh} highlight={aiPanelRefresh > 0} />

          {/* Add Track Input */}
          <div className="mb-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={importInput}
                onChange={e => setImportInput(e.target.value)}
                onKeyPress={e => e.key === 'Enter' && addTrack()}
                placeholder="Paste Spotify songs, or a Deezer or Apple Music playlist..."
                className="flex-1 bg-black border border-white/30 px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-white font-mono"
                disabled={isAnalyzing}
              />
              <button
                onClick={addTrack}
                disabled={!importInput.trim() || isAnalyzing}
                className="px-3 py-2 bg-white text-black hover:bg-gray-200 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors flex items-center gap-1 font-semibold font-mono text-sm"
              >
                <Plus className="w-4 h-4" />
                {isAnalyzing ? '...' : 'Add'}
              </button>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-white/40 font-mono">
              Tip: in the Spotify desktop app, open On Repeat (or any playlist), select all (Cmd/Ctrl+A) and copy (Cmd/Ctrl+C) to paste up to 30 at once.
            </p>
            {playlistProgress && (
              <div className="mt-2 border border-white/30 bg-black/50 p-2 font-mono">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-white text-xs truncate">{playlistProgress.song ?? 'Finding your songs...'}</span>
                  <span className="text-white/60 text-xs shrink-0">
                    {playlistProgress.processed}/{playlistProgress.total}
                  </span>
                </div>
                {playlistProgress.stage && (
                  <div className="mb-1.5 text-[10px] uppercase tracking-[0.15em] text-white/40">{playlistProgress.stage}</div>
                )}
                <div className="w-full h-1 bg-white/20 overflow-hidden">
                  <div
                    className="h-full bg-white transition-all duration-300"
                    style={{ width: `${(playlistProgress.processed / playlistProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}
            {error && (
              <div className="mt-2 text-white text-xs font-mono border border-white/50 bg-white/10 p-2">
                {error}
              </div>
            )}
          </div>

          {view === 'list' ? (
            <p className="text-xs text-white/40 font-mono">
              Managing songs in the list. Switch back to the galaxy to see them in orbit.
            </p>
          ) : (
          <>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2 text-white font-mono">
              <Sparkles className="w-5 h-5" />
              {selectedOrbit !== null ? `Orbit ${selectedOrbit}` : 'All Tracks'}
            </h2>
            {selectedOrbit !== null && (
              <button
                onClick={() => setSelectedOrbit(null)}
                className="text-xs text-white/60 hover:text-white font-mono border border-white/30 px-2 py-1"
              >
                Clear Filter
              </button>
            )}
          </div>

          {/* Orbit navigation */}
          <div className="flex gap-1 mb-4 flex-wrap">
            {[1, 2, 3, 4, 5, 6].map(orbit => (
              <button
                key={orbit}
                onClick={() => setSelectedOrbit(selectedOrbit === orbit ? null : orbit)}
                className={`px-3 py-1 text-xs font-mono border transition-colors ${
                  selectedOrbit === orbit
                    ? 'bg-white text-black border-white'
                    : 'bg-black text-white border-white/30 hover:border-white'
                }`}
              >
                {orbit}
              </button>
            ))}
          </div>

          <div className="text-xs text-white/50 font-mono mb-4">
            Orbit 1: Newest | Orbit 6: Oldest
          </div>

          {/* Track list by orbit */}
          {selectedOrbit === null ? (
            // Show all tracks grouped by orbit
            tracksByOrbit.map((orbitTracks, orbitIndex) => (
              orbitTracks.length > 0 && (
                <div key={orbitIndex} className="mb-4">
                  <h3 className="text-sm font-semibold text-white/60 mb-2 font-mono border-b border-white/20 pb-1">
                    Orbit {orbitIndex + 1} ({orbitTracks.length})
                  </h3>
                  <div className="space-y-2">
                    {orbitTracks.map(track => (
                      <TrackCard
                        key={track.id}
                        track={track}
                        isExpanded={expandedTracks.has(track.id)}
                        onToggleExpand={() => toggleTrackExpanded(track.id)}
                        onDelete={() => deleteTrack(track.id)}
                        isSelected={selectedTrack?.id === track.id}
                      />
                    ))}
                  </div>
                </div>
              )
            ))
          ) : (
            // Show filtered tracks
            <div className="space-y-2">
              {filteredTracks.map(track => (
                <TrackCard
                  key={track.id}
                  track={track}
                  isExpanded={expandedTracks.has(track.id)}
                  onToggleExpand={() => toggleTrackExpanded(track.id)}
                  onDelete={() => deleteTrack(track.id)}
                  isSelected={selectedTrack?.id === track.id}
                />
              ))}
            </div>
          )}

          {tracks.length === 0 && (
            <div className="text-center text-white/50 py-12 font-mono">
              <Music className="w-12 h-12 mx-auto mb-4 text-white/30" />
              <p className="text-white">No tracks yet</p>
              <p className="text-sm mt-2">Add a Spotify track to begin</p>
            </div>
          )}
          </>
          )}
        </div>
      </div>

      {/* SVG overlay for pointer line */}
      {selectedTrack && trackScreenPos && tooltipPosition && isTooltipReady && (
        <svg
          className="fixed inset-0 pointer-events-none z-[999]"
          style={{
            width: '100vw',
            height: '100vh',
            opacity: 1,
            transition: 'opacity 0.2s ease-in'
          }}
        >
          <defs>
            <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(255, 255, 255, 0.2)" />
              <stop offset="50%" stopColor="rgba(255, 255, 255, 0.4)" />
              <stop offset="100%" stopColor="rgba(255, 255, 255, 0.7)" />
              <animate attributeName="x1" values="0%;20%;0%" dur="3s" repeatCount="indefinite" />
            </linearGradient>
          </defs>
          {/* Line from modal to sphere */}
          <line
            x1={tooltipPosition.x}
            y1={tooltipPosition.y}
            x2={trackScreenPos.x}
            y2={trackScreenPos.y}
            stroke="url(#lineGradient)"
            strokeWidth="1.5"
            strokeDasharray="5 3"
            opacity="0.7"
          >
            <animate
              attributeName="stroke-dashoffset"
              from="0"
              to="16"
              dur="1s"
              repeatCount="indefinite"
            />
          </line>
          {/* Glow line underneath */}
          <line
            x1={tooltipPosition.x}
            y1={tooltipPosition.y}
            x2={trackScreenPos.x}
            y2={trackScreenPos.y}
            stroke="rgba(255, 255, 255, 0.2)"
            strokeWidth="3"
            opacity="0.3"
            style={{ filter: 'blur(2px)' }}
          />
          {/* Dot at sphere position */}
          <circle
            cx={trackScreenPos.x}
            cy={trackScreenPos.y}
            r="4"
            fill="white"
            opacity="0.9"
            style={{
              filter: 'drop-shadow(0 0 6px rgba(255, 255, 255, 0.9))',
            }}
          >
            <animate
              attributeName="r"
              values="4;5;4"
              dur="2s"
              repeatCount="indefinite"
            />
          </circle>
          {/* Outer ring at sphere */}
          <circle
            cx={trackScreenPos.x}
            cy={trackScreenPos.y}
            r="8"
            fill="none"
            stroke="white"
            strokeWidth="1"
            opacity="0.3"
          >
            <animate
              attributeName="r"
              values="8;12;8"
              dur="2s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0.3;0.1;0.3"
              dur="2s"
              repeatCount="indefinite"
            />
          </circle>
          {/* Dot at modal connection */}
          <circle
            cx={tooltipPosition.x}
            cy={tooltipPosition.y}
            r="3"
            fill="white"
            opacity="0.7"
          />
        </svg>
      )}

      {/* SVG overlay for nucleus chat pointer line */}
      {isChatOpen && nucleusScreenPos && nucleusChatPosition && isNucleusChatReady && (
        <svg
          className="fixed inset-0 pointer-events-none z-[999]"
          style={{
            width: '100vw',
            height: '100vh',
            opacity: 1,
            transition: 'opacity 0.2s ease-in'
          }}
        >
          <defs>
            <linearGradient id="nucleusLineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(255, 255, 255, 0.2)" />
              <stop offset="50%" stopColor="rgba(255, 255, 255, 0.4)" />
              <stop offset="100%" stopColor="rgba(255, 255, 255, 0.7)" />
              <animate attributeName="x1" values="0%;20%;0%" dur="3s" repeatCount="indefinite" />
            </linearGradient>
          </defs>
          {/* Line from chat popup to nucleus */}
          <line
            x1={nucleusChatPosition.x}
            y1={nucleusChatPosition.y}
            x2={nucleusScreenPos.x}
            y2={nucleusScreenPos.y}
            stroke="url(#nucleusLineGradient)"
            strokeWidth="1.5"
            strokeDasharray="5 3"
            opacity="0.7"
          >
            <animate
              attributeName="stroke-dashoffset"
              from="0"
              to="16"
              dur="1s"
              repeatCount="indefinite"
            />
          </line>
          {/* Glow line underneath */}
          <line
            x1={nucleusChatPosition.x}
            y1={nucleusChatPosition.y}
            x2={nucleusScreenPos.x}
            y2={nucleusScreenPos.y}
            stroke="rgba(255, 255, 255, 0.2)"
            strokeWidth="3"
            opacity="0.3"
            style={{ filter: 'blur(2px)' }}
          />
          {/* Pulsing dot at nucleus position */}
          <circle
            cx={nucleusScreenPos.x}
            cy={nucleusScreenPos.y}
            r="4"
            fill="white"
            opacity="0.9"
            style={{
              filter: 'drop-shadow(0 0 6px rgba(255, 255, 255, 0.9))',
            }}
          >
            <animate
              attributeName="r"
              values="4;5;4"
              dur="2s"
              repeatCount="indefinite"
            />
          </circle>
          {/* Outer ring at nucleus */}
          <circle
            cx={nucleusScreenPos.x}
            cy={nucleusScreenPos.y}
            r="8"
            fill="none"
            stroke="white"
            strokeWidth="1"
            opacity="0.3"
          >
            <animate
              attributeName="r"
              values="8;12;8"
              dur="2s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0.3;0.1;0.3"
              dur="2s"
              repeatCount="indefinite"
            />
          </circle>
          {/* Dot at chat popup connection */}
          <circle
            cx={nucleusChatPosition.x}
            cy={nucleusChatPosition.y}
            r="3"
            fill="white"
            opacity="0.7"
          />
        </svg>
      )}

      {/* Track tooltip */}
      {selectedTrack && (
        <div ref={tooltipRef} className="track-tooltip" style={sidebarCollapsed ? { right: '40px' } : undefined}>
          <div className="tooltip-header">
            <div className="tooltip-icon" />
            <h3 className="tooltip-title">{selectedTrack.title}</h3>
          </div>
          <div className="tooltip-divider" />
          <div className="tooltip-content">
            {selectedTrack.artist && (
              <p className="tooltip-artist">{selectedTrack.artist}</p>
            )}
            {selectedTrack.genre && (
              <p className="tooltip-genre">{selectedTrack.genre}</p>
            )}
            {selectedTrack.mood_description && (
              <p className="tooltip-mood">{selectedTrack.mood_description}</p>
            )}
            {(selectedTrack.addressee || selectedTrack.stance || selectedTrack.themes.length > 0) && (
              <p className="tooltip-genre">{songSignals(selectedTrack)}</p>
            )}

            {/* Switch track confirmation */}
            {showSwitchConfirm && playingTrack && (
              <div className="mt-4 pt-4 border-t border-white/20">
                <p className="text-white text-xs mb-2 font-mono">Currently playing:</p>
                <p className="text-white/60 text-xs mb-3 font-mono">{playingTrack.title} - {playingTrack.artist}</p>
                <button
                  onClick={confirmTrackChange}
                  className="w-full px-3 py-2 bg-white text-black text-sm hover:bg-gray-200 transition-colors font-mono"
                >
                  Switch to this
                </button>
              </div>
            )}

            <button
              onClick={() => {
                setSelectedTrack(null)
                setShowSwitchConfirm(false)
                visualizationRef.current?.resetCamera()
              }}
              className="tooltip-close"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Audio player bar */}
      {(playingTrack || isLoadingVideo) && (
        <div className={`fixed bottom-0 left-0 z-50 bg-black/95 backdrop-blur-sm border-t border-white/20 font-mono transition-[right] duration-300 ${sidebarCollapsed ? 'right-0' : 'right-80'}`}>
          {/* Seek bar */}
          {seekDuration > 0 && (
            <div className="px-4 pt-2 flex items-center gap-2">
              <span className="text-[10px] text-white/40 w-10 text-right tabular-nums">
                {formatTime(seekProgress)}
              </span>
              <input
                type="range"
                min={0}
                max={seekDuration}
                step={0.5}
                value={seekProgress}
                onChange={handleSeek}
                className="flex-1 h-1 appearance-none bg-white/20 cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-none [&::-moz-range-thumb]:w-2 [&::-moz-range-thumb]:h-2 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-none"
                style={{
                  background: `linear-gradient(to right, rgba(255,255,255,0.7) ${(seekProgress / seekDuration) * 100}%, rgba(255,255,255,0.2) ${(seekProgress / seekDuration) * 100}%)`,
                }}
              />
              <span className="text-[10px] text-white/40 w-10 tabular-nums">
                {formatTime(seekDuration)}
              </span>
            </div>
          )}
          {/* Controls row */}
          <div className="px-4 py-2 flex items-center gap-4">
            <button
              onClick={() => skip(-1)}
              disabled={!queueInfo || queueInfo.index === 0}
              className="w-7 h-7 flex items-center justify-center text-white/60 hover:text-white disabled:opacity-25"
              aria-label="Previous song"
            >
              <SkipBack className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={togglePlayback}
              disabled={isLoadingVideo}
              className="w-8 h-8 flex items-center justify-center text-white hover:text-white/80 transition-colors border border-white/30 disabled:opacity-40"
            >
              {isLoadingVideo ? (
                <span className="animate-pulse text-xs">...</span>
              ) : isPlaying ? (
                <Pause className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={() => skip(1)}
              disabled={!queueInfo || queueInfo.index + 1 >= queueInfo.length}
              className="w-7 h-7 flex items-center justify-center text-white/60 hover:text-white disabled:opacity-25"
              aria-label="Next song"
            >
              <SkipForward className="w-3.5 h-3.5" />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">
                {playingTrack?.title ?? 'Searching YouTube...'}
              </p>
              <p className="text-xs text-white/50 truncate">
                {isLoadingVideo ? 'finding it on youtube...' : playingTrack?.artist}
              </p>
            </div>
            {queueInfo && queueInfo.length > 1 && (
              <span className="text-[10px] text-white/40 tabular-nums shrink-0">
                {queueInfo.index + 1} / {queueInfo.length}
              </span>
            )}
            <button
              onClick={toggleShuffle}
              aria-pressed={shuffle}
              className={`w-7 h-7 flex items-center justify-center transition-colors ${shuffle ? 'text-white' : 'text-white/35 hover:text-white/70'}`}
              aria-label={shuffle ? 'Shuffle on' : 'Shuffle off'}
              title="Shuffle"
            >
              <Shuffle className="w-3.5 h-3.5" />
            </button>
            {isPlaying && <Volume2 className="w-4 h-4 text-white/40" />}
            <button
              onClick={stopPlayback}
              className="w-6 h-6 flex items-center justify-center text-white/40 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Nucleus Chat */}
      <NucleusChat
        ref={nucleusChatRef}
        nucleusId={nucleusId}
        nucleusName={nucleusName}
        isOpen={isChatOpen}
        onClose={() => {
          setIsChatOpen(false)
          if (view === 'galaxy') visualizationRef.current?.resetCamera()
        }}
        sidebarCollapsed={sidebarCollapsed}
      />
    </div>
  )
}

interface TrackCardProps {
  track: Track
  isExpanded: boolean
  onToggleExpand: () => void
  onDelete: () => void
  isSelected: boolean
}

function TrackCard({ track, isExpanded, onToggleExpand, onDelete, isSelected }: TrackCardProps) {
  return (
    <div
      className={`bg-black border border-white/20 p-3 transition-colors group font-mono track-card-enter ${
        isSelected ? 'border-white' : 'hover:border-white/50'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-white truncate">{track.title}</p>
          <p className="text-xs text-white/60 truncate">{track.artist}</p>
          {track.genre && (
            <p className="text-xs text-white/40 mt-1">{track.genre}</p>
          )}
        </div>
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-white transition-all flex-shrink-0"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      {track.mood_description && (
        <div className="mt-2">
          <p className={`text-xs text-white/60 ${isExpanded ? '' : 'line-clamp-2'}`}>
            {track.mood_description}
          </p>
          {track.mood_description.length > 100 && (
            <button
              onClick={onToggleExpand}
              className="text-xs text-white/40 hover:text-white mt-1 flex items-center gap-1"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="w-3 h-3" />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDown className="w-3 h-3" />
                  Show more
                </>
              )}
            </button>
          )}
        </div>
      )}
      {track.lyrical_style && (
        <p className={`text-xs text-white/40 mt-1 ${isExpanded ? '' : 'hidden'}`}>
          <span className="text-white/30">Style:</span> {track.lyrical_style}
        </p>
      )}
      {track.genius_url && (
        <a
          href={track.genius_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-white/50 hover:text-white hover:underline mt-2 inline-block"
        >
          View lyrics
        </a>
      )}
    </div>
  )
}
