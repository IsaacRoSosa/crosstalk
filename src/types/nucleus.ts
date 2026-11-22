import type { Emotion } from './track'

// Guests (anonymous sessions) get one nucleus; Google accounts up to this many.
// The database enforces the same limits (see the limit_nuclei_per_user migrations).
export const MAX_NUCLEI = 20

// Album covers kept per nucleus to paint its planet in the library
export const MAX_SUMMARY_COVERS = 12

// A nucleus as the library shows it
export interface NucleusSummary {
  id: number
  name: string
  dominantEmotion: Emotion | null
  createdAt: string
  updatedAt: string
  trackCount: number
  // How many of its songs carry each emotion
  emotions: Partial<Record<Emotion, number>>
  // Most recently added first
  covers: string[]
  lastAddedAt: string | null
}
