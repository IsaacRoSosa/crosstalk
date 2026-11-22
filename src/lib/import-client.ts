// Runs an import from the browser. The server works in time-boxed chunks (serverless functions get
// cut off after a few minutes), so this keeps posting back the songs it hasn't tried yet until
// there are none left, and adds the chunks up into one result.
import { apiFetch } from './api-client'
import type { Track } from '../types/track'

export interface ImportIssue {
  track: string
  artist: string
  reason: string
}

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

// More than enough for 40 songs; guards against looping forever if something goes wrong
const MAX_CHUNKS = 12

export async function importSongs(input: string, onChunk?: (soFar: ImportResult) => void): Promise<ImportResult> {
  const total: ImportResult = { successCount: 0, skippedCount: 0, failedCount: 0, tracks: [], skipped: [], failed: [] }
  let attempted = 0
  let pending: string | null = input

  for (let chunk = 0; pending && chunk < MAX_CHUNKS; chunk++) {
    let data: any
    try {
      const response = await apiFetch('/api/tracks/import', {
        method: 'POST',
        body: JSON.stringify({ input: pending, alreadyAdded: total.successCount, alreadyAttempted: attempted }),
      })
      data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not add your songs')
    } catch (error) {
      // Nothing was added yet: report the error. Otherwise keep what was added and say the rest didn't make it.
      if (chunk === 0) throw error
      total.notice = "Some songs weren't added because the connection was interrupted. Paste them again to retry."
      break
    }

    total.successCount += data.successCount ?? 0
    total.skippedCount += data.skippedCount ?? 0
    total.failedCount += data.failedCount ?? 0
    total.tracks.push(...(data.tracks ?? []))
    total.skipped.push(...(data.skipped ?? []))
    total.failed.push(...(data.failed ?? []))
    total.notice = data.notice ?? total.notice
    total.aiError = data.aiError ?? total.aiError
    attempted += data.attempted ?? 0
    onChunk?.(total)

    // A chunk that tried nothing would just repeat itself
    pending = data.remaining && data.attempted > 0 ? data.remaining : null
  }

  return total
}
