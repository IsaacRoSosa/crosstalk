import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api-client'
import { startOpenRouterConnect } from '../lib/openrouter-connect'

interface AiConnectionStatus {
  connected: boolean
  keyHint: string | null
}

interface AiConnectionPanelProps {
  // Bump to re-check the status (e.g. after an import reported that the AI isn't connected)
  refreshToken?: number
  highlight?: boolean
}

// Shows whether the user's OpenRouter account is connected, with connect/disconnect buttons
export function AiConnectionPanel({ refreshToken = 0, highlight = false }: AiConnectionPanelProps) {
  const [status, setStatus] = useState<AiConnectionStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      const response = await apiFetch('/api/ai/connection')
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not check the AI connection')
      setStatus({ connected: data.connected, keyHint: data.keyHint })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check the AI connection')
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus, refreshToken])

  const connect = async () => {
    setBusy(true)
    setError(null)
    try {
      await startOpenRouterConnect()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the connection')
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await apiFetch('/api/ai/connection', { method: 'DELETE' })
      if (!response.ok) throw new Error('Could not disconnect')
      setStatus({ connected: false, keyHint: null })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect')
    } finally {
      setBusy(false)
    }
  }

  if (!status && !error) return null

  return (
    <div className={`mb-4 border p-3 font-mono text-xs ${highlight && !status?.connected ? 'border-white' : 'border-white/30'}`}>
      {status?.connected ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-white/70">
            AI: OpenRouter, free models{status.keyHint ? ` (…${status.keyHint})` : ''}
          </span>
          <button onClick={disconnect} disabled={busy} className="text-white/50 hover:text-white underline disabled:opacity-50">
            Disconnect
          </button>
        </div>
      ) : (
        <>
          <p className="text-white/70 mb-2">
            Connect your free OpenRouter account to analyze new songs and chat with your nucleus. Crosstalk only uses free models.
          </p>
          <button
            onClick={connect}
            disabled={busy}
            className="w-full px-3 py-2 bg-white text-black hover:bg-gray-200 disabled:bg-gray-700 disabled:text-gray-500 font-semibold"
          >
            {busy ? 'Opening OpenRouter...' : 'Connect OpenRouter'}
          </button>
          <p className="mt-2 text-[11px] leading-snug text-white/40">
            Free models may use what they receive (song lyrics and your chat) for training, depending on your OpenRouter privacy
            settings.
          </p>
        </>
      )}
      {error && <p className="mt-2 text-white/70">{error}</p>}
    </div>
  )
}
