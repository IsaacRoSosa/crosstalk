// Runs an import from the browser. The server streams what it's doing (see types/import.ts) and
// works in time-boxed chunks (serverless functions get cut off after a few minutes), so this keeps
// posting back the songs it hasn't tried yet until there are none left, and adds the chunks up.
import { apiFetch } from './api-client'
import type { ImportChunkSummary, ImportEvent, ImportIssue } from '../types/import'
import type { Track } from '../types/track'

export type { ImportIssue }

export interface ImportResult {
  successCount: number
  skippedCount: number
  failedCount: number
  tracks: Track[]
  skipped: ImportIssue[]
  failed: ImportIssue[]
  notice?: string
  aiError?: string
}

// Progress across the whole import, not just the current request
export type ImportProgress =
  | { type: 'start'; total: number }
  | { type: 'song'; position: number; total: number; title: string; artist: string; cover_url: string | null; cached: boolean }
  | { type: 'stage'; stage: 'lyrics' | 'analysis' }
  | { type: 'added'; track: Track }
  | { type: 'skipped' | 'failed'; title: string; artist: string; reason: string }

// More than enough for 40 songs; guards against looping forever if something goes wrong
const MAX_CHUNKS = 12

// Reads a newline-delimited JSON stream, calling onEvent for each line
async function readEvents(response: Response, onEvent: (event: ImportEvent) => void): Promise<void> {
  if (!response.body) throw new Error('The server sent an empty response')
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (value) buffer += value
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) onEvent(JSON.parse(line) as ImportEvent)
      newline = buffer.indexOf('\n')
    }
    if (done) break
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as ImportEvent)
}

// Posts one chunk and returns its summary, reporting progress along the way.
// `offset` is how many songs earlier chunks already looked at.
async function importChunk(
  body: Record<string, unknown>,
  offset: number,
  isFirst: boolean,
  onProgress: (progress: ImportProgress) => void,
): Promise<ImportChunkSummary> {
  const response = await apiFetch('/api/tracks/import', { method: 'POST', body: JSON.stringify(body) })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || 'Could not add your songs')
  }

  let summary: ImportChunkSummary | null = null
  let total = 0
  await readEvents(response, (event) => {
    switch (event.type) {
      case 'start':
        total = offset + event.total
        if (isFirst) onProgress({ type: 'start', total })
        break
      case 'song':
        onProgress({
          type: 'song',
          position: offset + event.index + 1,
          total,
          title: event.title,
          artist: event.artist,
          cover_url: event.cover_url,
          cached: event.cached,
        })
        break
      case 'stage':
      case 'added':
        onProgress(event)
        break
      case 'skipped':
      case 'failed':
        onProgress({ type: event.type, title: event.title, artist: event.artist, reason: event.reason })
        break
      case 'done':
        summary = event.summary
        break
      case 'error':
        throw new Error(event.error)
    }
  })
  if (!summary) throw new Error('The connection was interrupted before the import finished')
  return summary
}

export async function importSongs(
  nucleusId: number,
  input: string,
  onProgress: (progress: ImportProgress) => void = () => {},
): Promise<ImportResult> {
  const total: ImportResult = { successCount: 0, skippedCount: 0, failedCount: 0, tracks: [], skipped: [], failed: [] }
  let attempted = 0
  let pending: string | null = input

  for (let chunk = 0; pending && chunk < MAX_CHUNKS; chunk++) {
    let data: ImportChunkSummary
    try {
      data = await importChunk(
        { nucleusId, input: pending, alreadyAdded: total.successCount, alreadyAttempted: attempted },
        attempted,
        chunk === 0,
        onProgress,
      )
    } catch (error) {
      // Nothing was added yet: report the error. Otherwise keep what was added and say the rest didn't make it.
      if (chunk === 0) throw error
      total.notice = "Some songs weren't added because the connection was interrupted. Paste them again to retry."
      break
    }

    total.successCount += data.successCount
    total.skippedCount += data.skippedCount
    total.failedCount += data.failedCount
    total.tracks.push(...data.tracks)
    total.skipped.push(...data.skipped)
    total.failed.push(...data.failed)
    total.notice = data.notice ?? total.notice
    total.aiError = data.aiError ?? total.aiError
    attempted += data.attempted

    // A chunk that tried nothing would just repeat itself
    pending = data.remaining && data.attempted > 0 ? data.remaining : null
  }

  return total
}
