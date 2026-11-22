import { useEffect, useState } from 'react'
import { getSupabaseBrowserClient } from '../lib/supabase/client'
import { saveWithGoogle, signOut, toAccountInfo, type AccountInfo } from '../lib/auth'

// Who is signed in: a guest (anonymous session) with a "Save with Google" button, or their Google account
export function AccountPanel() {
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    supabase.auth.getSession().then(({ data }) => setAccount(toAccountInfo(data.session?.user)))
    // The anonymous session is created by the first API call, so listen for it
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setAccount(toAccountInfo(session?.user)))
    return () => data.subscription.unsubscribe()
  }, [])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setBusy(false)
    }
  }

  if (!account) return null

  return (
    <div className="mb-4 border border-white/30 p-3 font-mono text-xs">
      {account.isAnonymous ? (
        <>
          <p className="text-white/70 mb-2">
            You're a guest: your galaxy is only saved in this browser. Save it with Google to keep it and use it on other devices.
          </p>
          <button
            onClick={() => run(saveWithGoogle)}
            disabled={busy}
            className="w-full px-3 py-2 bg-white text-black hover:bg-gray-200 disabled:bg-gray-700 disabled:text-gray-500 font-semibold"
          >
            {busy ? 'Opening Google...' : 'Save with Google'}
          </button>
        </>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {account.avatarUrl && <img src={account.avatarUrl} alt="" className="w-6 h-6 rounded-full" referrerPolicy="no-referrer" />}
            <span className="text-white/70 truncate">{account.name ?? account.email}</span>
          </div>
          <button onClick={() => run(signOut)} disabled={busy} className="text-white/50 hover:text-white underline disabled:opacity-50 shrink-0">
            Sign out
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-white/70">{error}</p>}
    </div>
  )
}
