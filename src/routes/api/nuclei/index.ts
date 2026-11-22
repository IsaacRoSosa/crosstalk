import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, HttpError, json } from '../../../lib/http'
import { requireUser } from '../../../lib/session'
import { createNucleus, ensureFirstNucleus, listNucleusSummaries } from '../../../lib/repository'
import { MAX_NUCLEI, type NucleusSummary } from '../../../types/nucleus'
import type { NucleusRow } from '../../../lib/supabase/database.types'

const DEFAULT_NAME = 'New Nucleus'
// Postgres error when Row Level Security refuses a write (here: the per-account nucleus limit)
const RLS_VIOLATION = '42501'

function emptySummary(row: NucleusRow): NucleusSummary {
  return {
    id: row.id,
    name: row.name,
    dominantEmotion: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    trackCount: 0,
    emotions: {},
    covers: [],
    lastAddedAt: null,
  }
}

export const Route = createFileRoute('/api/nuclei/')({
  server: {
    handlers: {
      // The user's nuclei for the library, and whether they can make more
      GET: async ({ request }) => {
        try {
          const ctx = await requireUser(request)
          await ensureFirstNucleus(ctx.db, ctx.userId)
          const nuclei = await listNucleusSummaries(ctx.db)
          return json({ nuclei, isAnonymous: ctx.isAnonymous, limit: ctx.isAnonymous ? 1 : MAX_NUCLEI })
        } catch (error) {
          return errorResponse(error, 'Error listing nuclei')
        }
      },

      // Creates a nucleus. Guests are limited to one; saving with Google unlocks more.
      //
      // With { mode: 'onboarding' } it returns a nucleus to fill instead: an empty one if the user
      // has one (so abandoned onboardings don't pile up empty nuclei), a guest's only nucleus,
      // or else a new one.
      POST: async ({ request }) => {
        try {
          const ctx = await requireUser(request)
          const body = await request.json().catch(() => ({}))
          const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''

          if (body.mode === 'onboarding') {
            await ensureFirstNucleus(ctx.db, ctx.userId)
            const nuclei = await listNucleusSummaries(ctx.db)
            const empty = nuclei.filter((n) => n.trackCount === 0).at(-1)
            if (empty) return json({ nucleus: empty, created: false })
            if (ctx.isAnonymous) return json({ nucleus: nuclei[0], created: false })
          }

          if (ctx.isAnonymous) {
            throw new HttpError(403, 'Save your nucleus with Google to create more.', { code: 'google_required' })
          }

          let row: NucleusRow
          try {
            row = await createNucleus(ctx.db, ctx.userId, name || DEFAULT_NAME)
          } catch (error) {
            if ((error as { code?: string })?.code === RLS_VIOLATION) {
              throw new HttpError(403, `You can have up to ${MAX_NUCLEI} nuclei. Delete one to make room.`, { code: 'nucleus_limit' })
            }
            throw error
          }
          return json({ nucleus: emptySummary(row), created: true }, 201)
        } catch (error) {
          return errorResponse(error, 'Error creating nucleus')
        }
      },
    },
  },
})
