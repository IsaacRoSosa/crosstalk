import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { requireEnv } from '../env'

export type Db = SupabaseClient<Database>

const serverAuthOptions = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }

let adminClient: Db | null = null

// Server-only client with the secret key. Bypasses Row Level Security: use it only for
// writes users must not make themselves (the shared track catalog) and for verifying sessions.
export function getAdminClient(): Db {
  if (!adminClient) {
    adminClient = createClient<Database>(requireEnv('VITE_SUPABASE_URL'), requireEnv('SUPABASE_SECRET_KEY'), {
      auth: serverAuthOptions,
    })
  }
  return adminClient
}

// Client that acts as the signed-in user, so Row Level Security applies to every query.
export function getUserClient(accessToken: string): Db {
  return createClient<Database>(requireEnv('VITE_SUPABASE_URL'), requireEnv('VITE_SUPABASE_PUBLISHABLE_KEY'), {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: serverAuthOptions,
  })
}
