// What Crosstalk asks the AI: analyse lyrics, name a nucleus, and chat.
import { HttpError } from '../http'
import { log } from '../log'
import { chatCompletion, type ChatMessage } from './openrouter'
import { isEmotion, type Emotion } from '../../types/track'

export interface LyricsAnalysis {
  emotion: Emotion
  valence: number
  energy: number
  genre: string
  mood_description: string
  lyrical_style: string
  model: string
}

const LYRICS_ANALYSIS_PROMPT = `Analyze these song lyrics and provide an emotional and stylistic analysis.

Song: "{title}" by {artist}

Lyrics:
{lyrics}

Return your response in the following JSON format:
{
  "emotion": "<one of: joy, sadness, anger, fear, love, surprise, calm, nostalgia>",
  "valence": <0.0 to 1.0>,
  "energy": <0.0 to 1.0>,
  "genre": "<inferred genre from lyrical style>",
  "mood_description": "<2-3 sentence description of the emotional content and themes>",
  "lyrical_style": "<description of the lyrical style, writing approach, and poetic devices>"
}

Guidelines:
- emotion: Choose the PRIMARY emotion from the 8 options that best represents the lyrics
- valence: 0.0 = negative/sad themes, 1.0 = positive/uplifting themes
- energy: 0.0 = calm/introspective, 1.0 = intense/passionate
- genre: Infer from lyrical style (e.g., "indie folk", "hip-hop", "alternative rock", "pop ballad")
- mood_description: Capture the emotional essence and themes explored in the lyrics
- lyrical_style: Describe the writing style, metaphors used, narrative approach

Return ONLY the JSON, no markdown formatting or additional text.`

// Free models are long-context, but there's no need to send an entire 10-minute epic
const MAX_LYRICS_CHARS = 6000

function clamp01(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5
}

function parseAnalysis(text: string): Omit<LyricsAnalysis, 'model'> | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const raw = JSON.parse(match[0])
    const emotion = typeof raw.emotion === 'string' ? raw.emotion.toLowerCase().trim() : raw.emotion
    if (!isEmotion(emotion)) return null
    return {
      emotion,
      valence: clamp01(raw.valence),
      energy: clamp01(raw.energy),
      genre: String(raw.genre ?? '').slice(0, 100),
      mood_description: String(raw.mood_description ?? '').slice(0, 1000),
      lyrical_style: String(raw.lyrical_style ?? raw.vocal_characteristics ?? '').slice(0, 1000),
    }
  } catch {
    return null
  }
}

export async function analyzeLyrics(
  userId: string,
  apiKey: string,
  song: { title: string; artist: string; lyrics: string },
): Promise<LyricsAnalysis> {
  const prompt = LYRICS_ANALYSIS_PROMPT.replace('{title}', song.title)
    .replace('{artist}', song.artist)
    .replace('{lyrics}', song.lyrics.slice(0, MAX_LYRICS_CHARS))

  // Free models sometimes return malformed JSON; one retry fixes most of it
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { text, model } = await chatCompletion(userId, apiKey, [{ role: 'user', content: prompt }], { temperature: 0.3 })
    const analysis = parseAnalysis(text)
    if (analysis) return { ...analysis, model }
    log.warn('analysis', 'unparseable analysis', { track: `${song.title} - ${song.artist}`, model, attempt, preview: text.slice(0, 200) })
  }
  throw new HttpError(502, 'The AI returned an unexpected analysis. Please try again.', { code: 'ai_bad_output' })
}

export async function generateNucleusName(
  userId: string,
  apiKey: string,
  collection: { trackCount: number; topEmotions: string[]; genres: string[]; moodDescriptions: string[] },
): Promise<string> {
  const prompt = `Generate a short poetic name (2-4 words) for this music collection:
- ${collection.trackCount} tracks
- Dominant emotions: ${collection.topEmotions.join(', ')}
- Genres: ${collection.genres.join(', ')}
- Sample moods: ${collection.moodDescriptions.slice(0, 3).join(', ')}

Return ONLY the name, nothing else. Make it evocative and beautiful.`

  const { text } = await chatCompletion(userId, apiKey, [{ role: 'user', content: prompt }], { temperature: 0.9 })
  // Keep the first line, without quotes or markdown
  return text.split('\n').find((line) => line.trim())?.replace(/["'*_#`]/g, '').trim() ?? ''
}

export async function chatReply(
  userId: string,
  apiKey: string,
  systemPrompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  message: string,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ]
  const { text } = await chatCompletion(userId, apiKey, messages)
  // Some free models think out loud in <think> tags; drop that
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
}
