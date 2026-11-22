import type { Emotion } from './track'

// Guests (anonymous sessions) get one nucleus; Google accounts up to this many.
// The database enforces the same limits (see the limit_nuclei_per_user migrations).
export const MAX_NUCLEI = 20

// Guests' accounts are deleted after this many days without a visit (a nightly job in the
// database, see the delete_inactive_guests migration)
export const GUEST_RETENTION_DAYS = 30

// Songs added per import: On Repeat has 30, so it fits whole
export const MAX_SONGS_PER_IMPORT = 30

// A nucleus is a first impression, not an archive: past this the galaxy gets crowded
// and the chat only ever sees a sample anyway
export const MAX_TRACKS_PER_NUCLEUS = 100

// Album covers kept per nucleus to paint its planet in the library
export const MAX_SUMMARY_COVERS = 12

// A nucleus as the library shows it
export interface NucleusSummary {
  id: number
  name: string
  dominantEmotion: Emotion | null
  // The AI's first impression of the person, from these songs (null until read)
  impression: string | null
  createdAt: string
  updatedAt: string
  trackCount: number
  // How many of its songs carry each emotion
  emotions: Partial<Record<Emotion, number>>
  // Most recently added first
  covers: string[]
  lastAddedAt: string | null
}
