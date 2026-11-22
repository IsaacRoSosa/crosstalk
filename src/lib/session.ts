import { HttpError } from './http'
import { getNucleus } from './repository'
import { getAdminClient, getUserClient, type Db } from './supabase/server'
import type { NucleusRow } from './supabase/database.types'
import { requireOpenRouterKey } from './ai/connection'

export interface UserContext {
  userId: string
  // Guests use an anonymous session; Google accounts aren't anonymous
  isAnonymous: boolean
  // Acts as the user: Row Level Security applies
  db: Db
  // The user's OpenRouter key, loaded on first use; throws if they haven't connected it
  getAiKey: () => Promise<string>
}

// A request about one of the user's nuclei
export interface NucleusContext extends UserContext {
  nucleus: NucleusRow
}

// Verifies the Supabase access token sent by the browser (Authorization: Bearer <token>).
// Anonymous sessions are valid users too.
export async function requireUser(request: Request): Promise<UserContext> {
  const header = request.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  if (!token) {
    throw new HttpError(401, 'Not signed in')
  }

  const { data, error } = await getAdminClient().auth.getUser(token)
  if (error || !data.user) {
    throw new HttpError(401, 'Your session expired. Reload the page.')
  }

  const userId = data.user.id
  const db = getUserClient(token)

  let aiKey: Promise<string> | null = null
  const getAiKey = () => {
    aiKey ??= requireOpenRouterKey(userId)
    return aiKey
  }

  return { userId, isAnonymous: data.user.is_anonymous === true, db, getAiKey }
}

// Accepts a nucleus id from JSON (number) or a query string / route param (numeric string)
export function parseNucleusId(value: unknown): number {
  const id = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
    throw new HttpError(400, 'Invalid nucleus id')
  }
  return id
}

// Loads one of the user's nuclei. Row Level Security hides other people's nuclei, so someone
// else's id looks exactly like one that doesn't exist.
export async function requireNucleus(ctx: UserContext, nucleusId: unknown): Promise<NucleusContext> {
  const nucleus = await getNucleus(ctx.db, parseNucleusId(nucleusId))
  if (!nucleus) {
    throw new HttpError(404, 'Nucleus not found', { code: 'nucleus_not_found' })
  }
  return { ...ctx, nucleus }
}

// Track ids for bulk actions: a non-empty list of positive integers, without duplicates
export function parseTrackIds(value: unknown, max = 500): number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) {
    throw new HttpError(400, `Send between 1 and ${max} track ids`)
  }
  if (!value.every((id) => Number.isSafeInteger(id) && id > 0)) {
    throw new HttpError(400, 'Invalid track id')
  }
  return [...new Set(value as number[])]
}
