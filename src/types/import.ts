import type { Track } from './track'

// What an import reports while it runs, one JSON object per line (NDJSON)
export type ImportEvent =
  // How many songs this request will look at (an upper bound: it stops early once enough are added)
  | { type: 'start'; total: number }
  // Starting on a song. `cached` means it was analysed before, so it's added without the AI.
  | { type: 'song'; index: number; title: string; artist: string; cover_url: string | null; cached: boolean }
  | { type: 'stage'; stage: 'lyrics' | 'analysis' }
  | { type: 'added'; track: Track }
  | { type: 'skipped'; title: string; artist: string; reason: string }
  | { type: 'failed'; title: string; artist: string; reason: string; debug?: Record<string, unknown> }
  | { type: 'done'; summary: ImportChunkSummary }
  // Something broke after the stream started
  | { type: 'error'; error: string }

export interface ImportIssue {
  track: string
  artist: string
  reason: string
}

export interface ImportChunkSummary {
  successCount: number
  skippedCount: number
  failedCount: number
  tracks: Track[]
  skipped: ImportIssue[]
  failed: ImportIssue[]
  notice?: string
  aiError?: string
  // Songs looked at by this request
  attempted: number
  // Links for the songs not tried yet, to send in the next request (null when finished)
  remaining: string | null
}
