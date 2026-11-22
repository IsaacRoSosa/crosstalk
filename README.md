# Crosstalk

**How much of you is in your library?**

Crosstalk reads the lyrics of the songs you keep coming back to and builds a *nucleus*: a 3D galaxy of your songs, each one read for mood, plus a first impression of you, before anyone says a word.

![Crosstalk](crosstalk.png)

No account is needed to start. The AI runs on the visitor's own free [OpenRouter](https://openrouter.ai) account, so the app costs nothing to run per user, and nobody can spend money through it.

## Features

- **A nucleus per playlist or mood.** Paste songs and each one is read from its lyrics: its feeling (and a second one if it's mixed), who it's sung to, the singer's attitude, its themes and one plain line on what it's really doing. Songs orbit the nucleus as glass spheres with their album art.
- **First impression.** Patterns across the songs (who they're sung to, recurring themes, the song that doesn't fit) are worked out in code, then turned into a few honest lines and a name for the collection.
- **On Repeat first.** Onboarding recommends Spotify's On Repeat playlist: what you actually play, not what you'd pick to show. Imports take up to 30 songs and stream their progress song by song.
- **Library of planets.** Each nucleus is a planet painted with its covers and ringed by its mix of emotions. Guests get one nucleus; saving with Google unlocks up to 20.
- **List view.** Search, filter by emotion, sort, select (shift-click for ranges), remove, or move and copy songs between nuclei.
- **Play.** Any song plays through YouTube and carries on through the rest of the nucleus, with shuffle.
- **Chat.** Talk to the nucleus about the songs in it.
- **Privacy.** A plain-language [privacy page](src/routes/privacy.tsx), a profile page to delete everything, and guest accounts that are removed after 30 days without a visit.

## How it works

1. **Songs come in** as pasted links: Spotify songs (copied from the desktop app), Deezer songs or public Deezer playlists. Spotify's 2026 Development Mode no longer lets apps read playlists, so copy and paste is the way in.
2. **Lyrics** come from [LRCLIB](https://lrclib.net). They're used for the reading and never stored. Genius is only used to link to a song's lyrics page.
3. **The reading** is done by a free model through the user's OpenRouter key, with the song's genre from Deezer's catalog as a hint. Each song is read once and kept in a shared catalog, so the next person who adds it doesn't spend AI on it again.
4. **The nucleus** is drawn with Three.js; the newest songs orbit closest.

## Stack

- [TanStack Start](https://tanstack.com/start) (React 19, TanStack Router, server routes on Nitro), Vite, Tailwind CSS 4, Three.js
- [Supabase](https://supabase.com): Postgres with Row Level Security, anonymous sign-ins, Google sign-in, pg_cron
- [OpenRouter](https://openrouter.ai) free models, connected per user with OAuth (PKCE)
- LRCLIB, Deezer, Spotify Web API, Genius, YouTube Data API
- Deployed on [Vercel](https://vercel.com)

## Architecture notes

- **Data model.** `tracks` is a shared catalog of analysed songs, written only by the server. `nuclei` belong to users, `nucleus_tracks` links the two, and `chat_messages` hang off a nucleus. Song readings are reused across users and matched by ISRC across Spotify and Deezer.
- **Security.** Every table uses Row Level Security: users only see and change their own nuclei, and the catalog is read-only to them. The database itself enforces one nucleus for guests and twenty for Google accounts. API routes verify the user's Supabase token and act as that user. Only catalog writes use the secret key.
- **AI keys.** The OpenRouter key from the OAuth flow is encrypted with AES-256-GCM before it's stored. It's limited to one cent of credit, and the server refuses any non-free model.
- **Imports.** They run sequentially to respect free rate limits, stream NDJSON progress events, and work in time-boxed chunks that the browser resumes, so they fit within serverless time limits.
- **Cleanup.** A nightly pg_cron job deletes guests inactive for 30 days; deleting a user cascades to everything they own.

## Running it locally

You'll need Node 22+, a Supabase project, and keys for Spotify, YouTube and (optionally) Genius.

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and fill it in. Only the `VITE_` values reach the browser; everything else stays on the server.
   ```bash
   # a fresh encryption key for stored AI keys (never change it once people use the app)
   openssl rand -base64 32
   ```
3. Apply the SQL in `supabase/migrations` to your project, in order (with the Supabase CLI: `supabase db push`).
4. In Supabase → Authentication:
   - enable **anonymous sign-ins** and **manual linking**
   - add the **Google** provider (client from Google Cloud, with `https://<project>.supabase.co/auth/v1/callback` as the redirect URI)
   - set the Site URL to `http://localhost:3000` and add `http://localhost:3000/**` to the Redirect URLs
5. Start it:
   ```bash
   npm run dev
   ```
   and open [http://localhost:3000](http://localhost:3000). Use `localhost:3000` exactly: Google and OpenRouter send people back there.

Each user connects their own OpenRouter account from inside the app, so there's no AI key to configure.

### Checking the outside services

```bash
node --env-file=.env scripts/check-spotify.mjs [spotify links...]   # which Spotify endpoints your app can use
node --env-file=.env scripts/check-lyrics.mjs                       # LRCLIB lookups
node --env-file=.env scripts/check-youtube.mjs                      # YouTube key and quota
```

### Scripts

```bash
npm run dev       # development server on port 3000
npm run build     # production build
npm run preview   # preview the production build
npm run test      # tests (Vitest)
npm run check     # lint and format check (Biome)
```

## Deploying

The app deploys to Vercel as is: functions run in `pdx1`, next to a Supabase project in `us-west-2`, with up to 300 s per request (see `vite.config.ts`). Set the same variables as `.env` in Vercel, with `APP_URL` pointing at the deployed domain, then add that domain to Google Cloud (authorized JavaScript origins) and to Supabase (Site URL and Redirect URLs).

## Limits worth knowing

- The free OpenRouter tier allows about 50 requests a day per user: roughly one import of 30 songs, plus a few chat messages.
- The YouTube Data API's default quota covers about 100 new song lookups a day for the whole app. Videos are cached per song.
- Spotify Development Mode apps can't read playlists, so Spotify songs are copied and pasted from the desktop app.

## Credits

Built by Ramiro Rodriguez, Benjamin Ortiz and Isaac Rojas Sosa. Forked from [ramiro-uziel/crosstalk](https://github.com/ramiro-uziel/crosstalk).

## License

MIT
