import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import { AiConnectionPanel } from '../components/AiConnectionPanel'
import { Eyebrow, PulseDot, Wordmark } from '../components/ui'
import { getSupabaseBrowserClient } from '../lib/supabase/client'
import { deleteAccount, saveWithGoogle, signOut, toAccountInfo, type AccountInfo } from '../lib/auth'
import { listNuclei, type NucleusLibrary } from '../lib/nuclei-client'
import { GUEST_RETENTION_DAYS } from '../types/nucleus'

export const Route = createFileRoute('/profile')({
  component: Profile,
  head: () => ({ meta: [{ title: 'Profile · Crosstalk' }] }),
})

const CONFIRM_WORD = 'delete'

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border border-white/20 p-5">
      <h2 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">{title}</h2>
      {children}
    </section>
  )
}

// The account, its AI connection, what's stored, and deleting it all
function Profile() {
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [library, setLibrary] = useState<NucleusLibrary | null>(null)
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState<'google' | 'signout' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    supabase.auth.getSession().then(({ data }) => setAccount(toAccountInfo(data.session?.user)))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setAccount(toAccountInfo(session?.user)))
    // Also starts a guest session if there's none yet, so the page always has an account to show
    listNuclei()
      .then(setLibrary)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load your nuclei'))
    return () => data.subscription.unsubscribe()
  }, [])

  const run = async (kind: 'google' | 'signout' | 'delete', action: () => Promise<void>) => {
    setBusy(kind)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setBusy(null)
    }
  }

  const nuclei = library?.nuclei ?? []
  const songs = nuclei.reduce((sum, n) => sum + n.trackCount, 0)
  const isGuest = account?.isAnonymous ?? library?.isAnonymous ?? true
  const confirmed = confirm.trim().toLowerCase() === CONFIRM_WORD

  return (
    <div className="min-h-screen bg-black font-mono text-white">
      <header className="flex items-center justify-between px-6 py-5">
        <Wordmark />
        <Link to="/app" className="text-[11px] uppercase tracking-[0.15em] text-white/50 hover:text-white">
          ← your nuclei
        </Link>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-6 pb-24 pt-6">
        <div className="mb-8">
          <Eyebrow>profile</Eyebrow>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">your account</h1>
        </div>

        <Block title="account">
          {!account ? (
            <p className="text-xs text-white/40">loading...</p>
          ) : isGuest ? (
            <div className="space-y-3 text-[13px] leading-relaxed text-white/70">
              <p className="flex items-center gap-2 text-white">
                <PulseDot size={6} /> guest
              </p>
              <p>
                Your nucleus lives in this browser only, and it's deleted after {GUEST_RETENTION_DAYS} days without a visit.
                Save it with Google to keep it, use it on other devices and make more nuclei.
              </p>
              <button
                onClick={() => run('google', saveWithGoogle)}
                disabled={busy !== null}
                className="bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-black hover:bg-white/85 disabled:opacity-40"
              >
                {busy === 'google' ? 'opening google...' : 'save with google'}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                {account.avatarUrl && (
                  <img src={account.avatarUrl} alt="" className="h-10 w-10 rounded-full" referrerPolicy="no-referrer" />
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm text-white">{account.name ?? 'Google account'}</div>
                  {account.email && <div className="truncate text-xs text-white/50">{account.email}</div>}
                </div>
              </div>
              <button
                onClick={() => run('signout', signOut)}
                disabled={busy !== null}
                className="border border-white/30 px-4 py-2 text-[11px] uppercase tracking-[0.12em] hover:border-white disabled:opacity-40"
              >
                {busy === 'signout' ? 'signing out...' : 'sign out'}
              </button>
            </div>
          )}
        </Block>

        <Block title="ai connection">
          <AiConnectionPanel />
        </Block>

        <Block title="what crosstalk has">
          <ul className="space-y-1.5 text-[13px] text-white/70">
            <li>
              {library ? `${nuclei.length} ${nuclei.length === 1 ? 'nucleus' : 'nuclei'} with ${songs} songs, their first impressions and your chats` : '...'}
            </li>
            <li>{isGuest ? 'a random guest id' : 'your Google email, name and picture'}</li>
            <li>your OpenRouter key, encrypted, if you connected it</li>
          </ul>
          <p className="mt-4 text-[12px] text-white/50">
            Nothing is sold or shared for ads.{' '}
            <Link to="/privacy" className="text-white underline">
              Read how your data is used
            </Link>
            .
          </p>
        </Block>

        <section className="border border-white/40 p-5">
          <h2 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-white">delete account</h2>
          <div className="space-y-3 text-[13px] leading-relaxed text-white/70">
            <p>
              This deletes your account, every nucleus in it, your chats and your OpenRouter key from Crosstalk, right away.
              It can't be undone.
            </p>
            <p className="text-[12px] text-white/50">
              To also revoke the key on OpenRouter's side, remove it in your{' '}
              <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer" className="text-white underline">
                OpenRouter keys
              </a>
              .
            </p>
            <form
              className="flex flex-wrap items-center gap-2 pt-1"
              onSubmit={(e) => {
                e.preventDefault()
                if (confirmed) run('delete', deleteAccount)
              }}
            >
              <label className="flex min-w-[220px] flex-1 items-center gap-2 border border-white/25 px-3 py-2 focus-within:border-white">
                <span className="shrink-0 text-[11px] text-white/40">type "{CONFIRM_WORD}"</span>
                <input
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full bg-transparent text-xs text-white focus:outline-none"
                  autoComplete="off"
                  aria-label={`Type ${CONFIRM_WORD} to confirm`}
                />
              </label>
              <button
                type="submit"
                disabled={!confirmed || busy !== null}
                className="bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-black hover:bg-white/85 disabled:bg-white/20 disabled:text-white/40"
              >
                {busy === 'delete' ? 'deleting...' : 'delete everything'}
              </button>
            </form>
          </div>
        </section>

        {error && <p className="text-[12px] text-white/80">{error}</p>}
      </main>
    </div>
  )
}
