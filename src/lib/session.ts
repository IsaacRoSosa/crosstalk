import { HttpError } from './http'
import { getOrCreateNucleus } from './repository'
import { getAdminClient, getUserClient, type Db } from './supabase/server'
import type { NucleusRow } from './supabase/database.types'

export interface UserContext {
  userId: string
  // Acts as the user: Row Level Security applies
  db: Db
  nucleus: NucleusRow
}

// Verifies the Supabase access token sent by the browser (Authorization: Bearer <token>)
// and loads the user's nucleus. Anonymous sessions are valid users too.
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

  const db = getUserClient(token)
  const nucleus = await getOrCreateNucleus(db, data.user.id)
  return { userId: data.user.id, db, nucleus }
}
