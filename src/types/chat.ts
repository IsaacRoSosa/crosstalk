export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface NucleusMetadata {
  id: number
  name: string
  dominant_emotion: string | null
  updated_at: string
}
