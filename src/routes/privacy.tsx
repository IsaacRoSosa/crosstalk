import { createFileRoute, Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Eyebrow, Wordmark } from '../components/ui'
import { GUEST_RETENTION_DAYS } from '../types/nucleus'

export const Route = createFileRoute('/privacy')({
  component: Privacy,
  head: () => ({
    meta: [
      { title: 'Privacy · Crosstalk' },
      { name: 'description', content: 'What Crosstalk stores, who else sees it, and how to delete it. We never sell your data.' },
    ],
  }),
})

const UPDATED = 'November 22, 2026'
const REPO = 'https://github.com/IsaacRoSosa/crosstalk'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-white/15 pt-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em]">{title}</h2>
      <div className="space-y-3 text-[13px] leading-relaxed text-white/70">{children}</div>
    </section>
  )
}

function Item({ name, children }: { name: string; children: ReactNode }) {
  return (
    <li className="grid gap-1 sm:grid-cols-[150px_1fr] sm:gap-4">
      <span className="text-white">{name}</span>
      <span>{children}</span>
    </li>
  )
}

// Plain-language privacy page. Keep it in step with what the code actually does.
function Privacy() {
  return (
    <div className="min-h-screen bg-black font-mono text-white">
      <header className="flex items-center justify-between px-6 py-5">
        <Wordmark />
        <Link to="/app" className="text-[11px] uppercase tracking-[0.15em] text-white/50 hover:text-white">
          your nuclei →
        </Link>
      </header>

      <main className="mx-auto max-w-2xl space-y-8 px-6 pb-24 pt-6">
        <div>
          <Eyebrow>privacy</Eyebrow>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">what happens with your data</h1>
          <p className="mt-4 text-[13px] leading-relaxed text-white/70">
            Crosstalk is a small independent project. The short version:{' '}
            <span className="text-white">
              we don't sell your data, we don't show ads, and we don't track you around the web.
            </span>{' '}
            We keep only what the app needs to show you your nuclei, and you can delete all of it whenever you want.
          </p>
          <p className="mt-2 text-[11px] text-white/40">Last updated {UPDATED}</p>
        </div>

        <Section title="what we store">
          <ul className="space-y-3">
            <Item name="your account">
              As a guest, just a random id. If you save with Google, also the email, name and profile picture Google shares when
              you sign in. We never see your Google password, and we don't get access to anything else in your Google account.
            </Item>
            <Item name="your nuclei">
              Their names, which songs are in them, their first impressions, and your chat with each nucleus.
            </Item>
            <Item name="your openrouter key">
              If you connect OpenRouter, the key it gives us is encrypted before it's saved and only used to ask free AI models
              about your songs. It's limited to free models and to a cent of credit, so it can't spend your money.
            </Item>
            <Item name="song readings">
              When a song is read for mood, that reading is saved once and reused for anyone who adds the same song, so nobody
              spends AI on it twice. It's about the song, not about you: other people never see who added it.
            </Item>
          </ul>
          <p>
            We don't store song lyrics: they're fetched when a song is read and thrown away afterwards. We don't connect to your
            Spotify account; songs come from the links you paste.
          </p>
        </Section>

        <Section title="who else sees what">
          <p>Crosstalk runs on a few outside services. Each one gets only what it needs:</p>
          <ul className="space-y-3">
            <Item name="supabase">Our database and sign-in. Everything listed above lives there.</Item>
            <Item name="vercel">
              Hosts the app. Like any web host, it keeps short-lived request logs. It also counts page views for us (which
              pages are visited, browser, country), without cookies and without knowing who you are.
            </Item>
            <Item name="cloudflare">
              Runs a quick check that you're a person (Turnstile) before a guest session starts. It sees your browser and IP address, not your
              songs.
            </Item>
            <Item name="google">Only when you choose to save with Google, to sign you in.</Item>
            <Item name="openrouter">
              Receives a song's title, artist and lyrics to read it, a summary of your nucleus for its first impression, and
              your chat messages. It passes them to whichever free model answers.{' '}
              <span className="text-white">
                Free models may use what they receive for training, depending on your{' '}
                <a href="https://openrouter.ai/settings/privacy" target="_blank" rel="noopener noreferrer" className="underline">
                  OpenRouter privacy settings
                </a>
                .
              </span>{' '}
              Don't put anything in the chat you wouldn't want a model provider to read.
            </Item>
            <Item name="lyrics and music catalogs">
              LRCLIB, Genius, Deezer and Spotify get a song's title, artist or id to find its lyrics, details and genre. They
              don't learn who you are: these requests come from our server.
            </Item>
            <Item name="youtube">
              When you play a song, we look up a video for it from our server, and the YouTube player loads in your browser.
              YouTube's own privacy policy applies to that player.
            </Item>
          </ul>
        </Section>

        <Section title="in your browser">
          <p>
            Your sign-in session is kept in your browser's storage, plus a few temporary values (like the songs you pasted while
            onboarding is still running). No advertising or analytics cookies.
          </p>
        </Section>

        <Section title="how long we keep it">
          <p>
            Guest accounts are deleted, with all their nuclei, after {GUEST_RETENTION_DAYS} days without a visit. Saved accounts
            stay until you delete them.
          </p>
          <p>
            You can delete your account any time from your{' '}
            <Link to="/profile" className="text-white underline">
              profile
            </Link>
            . That removes your account, your nuclei, your chats and your OpenRouter key from Crosstalk right away. Song
            readings stay in the shared catalog, since they aren't tied to you. Copies can linger in our database provider's
            backups for a short time before they roll over.
          </p>
          <p>
            Your OpenRouter key also lives in your OpenRouter account: you can revoke it there under{' '}
            <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer" className="text-white underline">
              keys
            </a>
            .
          </p>
        </Section>

        <Section title="questions">
          <p>
            Crosstalk is open source, so you can check all of this in the{' '}
            <a href={REPO} target="_blank" rel="noopener noreferrer" className="text-white underline">
              code
            </a>
            . For questions or requests,{' '}
            <a href={`${REPO}/issues`} target="_blank" rel="noopener noreferrer" className="text-white underline">
              open an issue
            </a>
            . If this page changes in a way that matters, we'll update the date above.
          </p>
        </Section>
      </main>
    </div>
  )
}
