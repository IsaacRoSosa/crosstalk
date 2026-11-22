// Stores each user's OpenRouter key, encrypted. Only the server (admin client) touches this table.
import { decryptSecret, encryptSecret } from '../crypto'
import { HttpError } from '../http'
import { getAdminClient } from '../supabase/server'

export interface AiConnectionStatus {
  connected: boolean
  provider: 'openrouter' | null
  keyHint: string | null
}

export async function getAiConnectionStatus(userId: string): Promise<AiConnectionStatus> {
  const { data, error } = await getAdminClient()
    .from('ai_connections')
    .select('provider, key_hint')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data
    ? { connected: true, provider: 'openrouter', keyHint: data.key_hint }
    : { connected: false, provider: null, keyHint: null }
}

export async function saveOpenRouterKey(userId: string, apiKey: string): Promise<void> {
  const { error } = await getAdminClient()
    .from('ai_connections')
    .upsert({
      user_id: userId,
      provider: 'openrouter',
      encrypted_key: encryptSecret(apiKey),
      key_hint: apiKey.slice(-4),
    })
  if (error) throw error
}

export async function deleteAiConnection(userId: string): Promise<void> {
  const { error } = await getAdminClient().from('ai_connections').delete().eq('user_id', userId)
  if (error) throw error
}

// The user's decrypted key, or an error telling them to connect their AI
export async function requireOpenRouterKey(userId: string): Promise<string> {
  const { data, error } = await getAdminClient()
    .from('ai_connections')
    .select('encrypted_key')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) {
    throw new HttpError(428, 'Connect your OpenRouter account to analyze new songs and chat.', { code: 'ai_not_connected' })
  }
  return decryptSecret(data.encrypted_key)
}
