// What Crosstalk asks the AI: read a song's lyrics, read a whole nucleus, and chat.
//
// Voice: like a perceptive friend who just scrolled through your recently played. Plain, specific,
// lowercase, a little teasing. Not a critic, not a therapist, not a horoscope.
import { HttpError } from '../http'
import { log } from '../log'
import { chatCompletion, type ChatMessage } from './openrouter'
import { ADDRESSEES, EMOTIONS, STANCES, oneOf, type Addressee, type Emotion, type Stance } from '../../types/track'

// Bump when the song prompt changes in a way worth re-reading old songs for (see track-pipeline.ts)
export const ANALYSIS_VERSION = 2

export interface LyricsAnalysis {
  emotion: Emotion
  secondary_emotion: Emotion | null
  valence: number
  energy: number
  addressee: Addressee | null
  stance: Stance | null
  themes: string[]
  // One short line on what the song is really doing
  take: string
  // A few words on how it's written
  style: string
  genre: string
  model: string
}

// Words that make text read like a model wrote it. Listed in the prompts, and checked afterwards.
const AI_TELLS = [
  'explores',
  'delves',
  'conveys',
  'captures',
  'poignant',
  'tapestry',
  'journey',
  'resonates',
  'evocative',
  'juxtapos',
  'navigat',
  'testament',
  'a blend of',
  'raw emotion',
  'vulnerability',
]
// Openings that give it away too
const AI_OPENINGS = ['the lyrics', 'the song', 'this song', 'this track']

function soundsGenerated(text: string): boolean {
  const lower = text.toLowerCase()
  return AI_TELLS.some((tell) => lower.includes(tell)) || AI_OPENINGS.some((opening) => lower.startsWith(opening))
}

const SONG_PROMPT = `You read song lyrics and say what a song is really about, the way a perceptive friend would. Not a critic, not a therapist.

Song: "{title}" by {artist}{genreHint}

Lyrics:
{lyrics}

Reply with only this JSON, nothing else:
{
  "emotion": "the feeling the song leaves you with. one of: ${EMOTIONS.join(', ')}",
  "secondary_emotion": "another one from that list if the song is genuinely mixed, otherwise null",
  "valence": "number from 0.0 (dark) to 1.0 (bright), for the lyrics",
  "energy": "number from 0.0 (restrained) to 1.0 (intense), for the lyrics",
  "addressee": "who the singer is talking to. one of: ${ADDRESSEES.join(', ')}",
  "stance": "the singer's attitude. one of: ${STANCES.join(', ')}",
  "themes": ["2 or 3 short lowercase themes, 1 to 3 words each"],
  "take": "one sentence, at most 18 words, saying what the song is doing",
  "style": "2 to 4 short lowercase descriptors of how it's written, comma separated",
  "genre": "the genre, 1 to 3 lowercase words"
}

How to write "take":
- plain and specific, like you'd tell a friend. lowercase. no exclamation marks.
- never start with "the song", "the lyrics", "this track", or the title. never quote the lyrics.
- don't use: ${AI_TELLS.join(', ')}
- good: "a breakup song that's mostly about not wanting to be the one who cares more"
- good: "bragging on the surface, but every verse circles back to feeling left out"
- good: "pure crush energy, the kind where you rehearse texts you'll never send"
- bad: "The lyrics convey a poignant exploration of love and loss."`

// Free models are long-context, but there's no need to send an entire 10-minute epic
const MAX_LYRICS_CHARS = 6000

function clamp01(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5
}

function cleanLine(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^["']|["']$/g, '')
    .trim()
    .slice(0, max)
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

function extractJson(text: string): Record<string, unknown> | null {
  const match = text.replace(/<think>[\s\S]*?<\/think>/g, '').match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

function parseAnalysis(text: string): Omit<LyricsAnalysis, 'model'> | null {
  const raw = extractJson(text)
  if (!raw) return null
  const emotion = oneOf(EMOTIONS, raw.emotion)
  const take = cleanLine(raw.take ?? raw.mood_description, 240)
  if (!emotion || !take) return null
  const secondary = oneOf(EMOTIONS, raw.secondary_emotion)
  const themes = (Array.isArray(raw.themes) ? raw.themes : [])
    .map((t) => cleanLine(t, 40).toLowerCase())
    .filter(Boolean)
    .slice(0, 3)
  return {
    emotion,
    secondary_emotion: secondary && secondary !== emotion ? secondary : null,
    valence: clamp01(raw.valence),
    energy: clamp01(raw.energy),
    addressee: oneOf(ADDRESSEES, raw.addressee),
    stance: oneOf(STANCES, raw.stance),
    themes,
    // Lowercase is part of the voice; models often capitalise anyway
    take: lowerFirst(take),
    style: cleanLine(raw.style ?? raw.lyrical_style, 120).toLowerCase(),
    genre: cleanLine(raw.genre, 60).toLowerCase(),
  }
}

export async function analyzeLyrics(
  userId: string,
  apiKey: string,
  song: { title: string; artist: string; lyrics: string; genreHint?: string | null },
): Promise<LyricsAnalysis> {
  const prompt = SONG_PROMPT.replace('{title}', song.title)
    .replace('{artist}', song.artist)
    .replace('{genreHint}', song.genreHint ? `\nFiled under: ${song.genreHint}` : '')
    .replace('{lyrics}', song.lyrics.slice(0, MAX_LYRICS_CHARS))

  // Free models sometimes return malformed JSON or slip into essay voice; one retry fixes most of it
  let fallback: LyricsAnalysis | null = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { text, model } = await chatCompletion(userId, apiKey, [{ role: 'user', content: prompt }], { temperature: 0.5 })
    const analysis = parseAnalysis(text)
    if (analysis && !soundsGenerated(analysis.take)) return { ...analysis, model }
    if (analysis) fallback ??= { ...analysis, model }
    log.warn('analysis', analysis ? 'take sounds generated' : 'unparseable analysis', {
      track: `${song.title} - ${song.artist}`,
      model,
      attempt,
      preview: (analysis?.take ?? text).slice(0, 200),
    })
  }
  // Better a slightly stiff line than no song at all
  if (fallback) return fallback
  throw new HttpError(502, 'The AI returned an unexpected analysis. Please try again.', { code: 'ai_bad_output' })
}

// ── Reading a whole nucleus ───────────────────────────────────────────────────

const READ_PROMPT = `You're giving someone a first impression of them, based only on the songs they keep playing. Like a friend who just scrolled through their recently played: observant, specific, a little teasing, warm underneath. Not a therapist, not a horoscope.

What their songs show:
{facts}

The songs:
{songs}

Reply with only this JSON, nothing else:
{"name": "...", "impression": "..."}

"name": 2 to 4 lowercase words naming this collection, like a playlist someone would actually make. specific to these songs. never use: symphony, echoes, tapestry, whispers, melodies, chronicles, odyssey.
"impression": 3 or 4 short sentences, under 70 words total, talking to them as "you".
- open with the most striking pattern, not a summary
- name one or two of their songs as evidence
- include one thing that doesn't fit, or a contradiction
- lowercase, plain words, no exclamation marks, no lyric quotes
- no diagnosing and no flattery. never "your music reveals", "it's clear that", "complex", "soul", "journey"
- it's a guess from music: a little playful is good, mean is not

Example of the voice (about different songs): "you like your heartbreak with a beat. most of these are sung at someone who already left, and none of them are asking them back. then there's that one love song, completely unbothered, like it wandered in from someone else's playlist. you're fine. probably."`

export interface NucleusRead {
  name: string
  impression: string
}

export async function readNucleus(userId: string, apiKey: string, facts: string, songs: string): Promise<NucleusRead> {
  const prompt = READ_PROMPT.replace('{facts}', facts).replace('{songs}', songs)
  let fallback: NucleusRead | null = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { text, model } = await chatCompletion(userId, apiKey, [{ role: 'user', content: prompt }], { temperature: 0.8 })
    const raw = extractJson(text)
    const name = cleanLine(raw?.name, 80).replace(/["'*_#`]/g, '').toLowerCase()
    const impression = cleanLine(raw?.impression, 1000)
    if (name && impression) {
      const read = { name, impression: lowerFirst(impression) }
      if (!soundsGenerated(impression)) return read
      fallback ??= read
    }
    log.warn('analysis', name && impression ? 'impression sounds generated' : 'unparseable nucleus read', {
      model,
      attempt,
      preview: text.slice(0, 200),
    })
  }
  if (fallback) return fallback
  throw new HttpError(502, 'The AI returned an unexpected answer. Please try again.', { code: 'ai_bad_output' })
}

// ── Chat ─────────────────────────────────────────────────────────────────────

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
