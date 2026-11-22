// "share" in the nucleus header: makes a public read-only link to the nucleus, copies it, or
// turns it off. The visitor sees the galaxy, the first impression and each song's read; not the
// chat or anything about the account.
import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Link2, Share2 } from 'lucide-react'
import { disableShareLink, enableShareLink, getShareLink } from '../lib/nuclei-client'

interface ShareButtonProps {
  nucleusId: number
  trackCount: number
}

function shareUrl(token: string): string {
  return `${window.location.origin}/s/${token}`
}

export function ShareButton({ nucleusId, trackCount }: ShareButtonProps) {
  const [open, setOpen] = useState(false)
  // undefined until loaded; null when the nucleus isn't shared
  const [token, setToken] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || token !== undefined) return
    getShareLink(nucleusId)
      .then(({ token }) => setToken(token))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the link'))
  }, [open, token, nucleusId])

  // Close on a click outside or Escape
  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const run = async (action: () => Promise<{ token: string | null }>) => {
    setBusy(true)
    setError(null)
    try {
      setToken((await action()).token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setError('Could not copy. Select the link and copy it by hand.')
    }
  }

  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const url = token ? shareUrl(token) : null

  return (
    <div ref={rootRef} className="pointer-events-auto relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={`flex h-8 items-center gap-1.5 border px-2.5 text-[10px] uppercase tracking-[0.15em] transition-colors ${
          open ? 'border-white bg-white text-black' : 'border-white/30 bg-black/80 text-white/60 hover:border-white/60 hover:text-white'
        }`}
      >
        <Share2 className="h-3.5 w-3.5" /> share
      </button>

      {open && (
        <div className="ct-fade-up absolute left-0 top-10 z-50 w-[min(340px,calc(100vw-2rem))] border border-white/25 bg-black p-4 font-mono text-white">
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">share this nucleus</div>
          <p className="mt-2 text-[11px] leading-relaxed text-white/65">
            Anyone with the link sees its songs, what crosstalk read in each one and the first impression. Not your chat or your
            account.
          </p>

          {trackCount === 0 ? (
            <p className="mt-3 text-[11px] text-white/50">Add some songs first.</p>
          ) : token === undefined && !error ? (
            <p className="mt-3 text-[11px] text-white/40">loading...</p>
          ) : url ? (
            <>
              <div className="mt-3 flex border border-white/30">
                <input
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 bg-transparent px-2 py-2 text-[11px] text-white/85 focus:outline-none"
                  aria-label="Share link"
                />
                <button
                  onClick={() => copy(url)}
                  className="flex items-center gap-1 border-l border-white/30 px-2.5 text-[10px] uppercase tracking-[0.15em] text-white/70 hover:bg-white hover:text-black"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'copied' : 'copy'}
                </button>
              </div>
              <div className="mt-3 flex items-center gap-4">
                {canNativeShare && (
                  <button
                    onClick={() => navigator.share({ title: 'My nucleus on Crosstalk', url }).catch(() => {})}
                    className="text-[10px] uppercase tracking-[0.15em] text-white/60 hover:text-white"
                  >
                    send...
                  </button>
                )}
                <button
                  onClick={() => run(() => disableShareLink(nucleusId))}
                  disabled={busy}
                  className="ml-auto text-[10px] uppercase tracking-[0.15em] text-white/40 hover:text-white disabled:opacity-50"
                  title="The link stops working. Sharing again makes a new one."
                >
                  {busy ? 'turning off...' : 'stop sharing'}
                </button>
              </div>
            </>
          ) : (
            <button
              onClick={() => run(() => enableShareLink(nucleusId))}
              disabled={busy}
              className="mt-3 flex items-center gap-1.5 bg-white px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-black hover:bg-white/85 disabled:bg-white/20 disabled:text-white/40"
            >
              <Link2 className="h-3.5 w-3.5" /> {busy ? 'creating...' : 'create link'}
            </button>
          )}

          {error && <p className="mt-3 text-[11px] text-white/60">{error}</p>}
        </div>
      )}
    </div>
  )
}
