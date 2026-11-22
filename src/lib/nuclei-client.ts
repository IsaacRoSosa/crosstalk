// Browser-side calls for nuclei and the songs in them.
import { apiFetch } from './api-client'
import type { NucleusSummary } from '../types/nucleus'
import type { Track } from '../types/track'

// An API error, with the server's machine-readable code when it sends one (e.g. 'google_required')
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message)
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(data.error || 'Something went wrong. Please try again.', response.status, data.code)
  }
  return data as T
}

const send = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) })

export interface NucleusLibrary {
  nuclei: NucleusSummary[]
  isAnonymous: boolean
  limit: number
}

export const listNuclei = () => call<NucleusLibrary>('/api/nuclei')

export const createNucleus = (options: { name?: string; mode?: 'onboarding' } = {}) =>
  call<{ nucleus: NucleusSummary; created: boolean }>('/api/nuclei', send('POST', options))

export const getNucleus = (nucleusId: number) =>
  call<{ nucleus: { id: number; name: string; dominant_emotion: string | null } }>(`/api/nuclei/${nucleusId}`)

export const renameNucleus = (nucleusId: number, name: string) =>
  call<{ nucleus: { id: number; name: string } }>(`/api/nuclei/${nucleusId}`, send('PATCH', { name }))

export const deleteNucleus = (nucleusId: number) => call<{ success: true }>(`/api/nuclei/${nucleusId}`, send('DELETE'))

// Lets the AI name the nucleus after its songs
export const autoNameNucleus = (nucleusId: number) =>
  call<{ name: string; dominantEmotion: string | null }>(`/api/nuclei/${nucleusId}/name`, send('POST'))

export const listTracks = (nucleusId: number) => call<{ tracks: Track[] }>(`/api/tracks?nucleus=${nucleusId}`)

export const removeTracks = (nucleusId: number, trackIds: number[]) =>
  call<{ removed: number }>('/api/tracks', send('DELETE', { nucleusId, trackIds }))

export const transferTracks = (fromNucleusId: number, toNucleusId: number, trackIds: number[], mode: 'copy' | 'move') =>
  call<{ added: number; alreadyThere: number; removed: number }>(
    '/api/tracks/transfer',
    send('POST', { fromNucleusId, toNucleusId, trackIds, mode }),
  )
