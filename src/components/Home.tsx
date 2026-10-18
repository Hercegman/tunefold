import { useEffect, useState } from 'react'
import { ArrowRight, Clock, Link2, Music2 } from 'lucide-react'
import { api } from '../api'
import type { Recent } from '../types'
import { Button, Cover, inputCls } from './ui'

export function Home({ onSubmit, busy, error }: { onSubmit: (url: string) => void; busy: boolean; error: string | null }) {
  const [url, setUrl] = useState('')
  const [recent, setRecent] = useState<Recent[]>([])

  useEffect(() => { api.recent().then(setRecent).catch(() => {}) }, [])

  useEffect(() => {
    // paste anywhere -> fill input
    const h = (e: ClipboardEvent) => {
      const t = e.clipboardData?.getData('text') || ''
      if (/open\.spotify\.com|spotify:/.test(t) && (document.activeElement as HTMLElement)?.tagName !== 'INPUT') setUrl(t.trim())
    }
    window.addEventListener('paste', h)
    return () => window.removeEventListener('paste', h)
  }, [])

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 px-6 pt-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent"><Music2 size={28} /></div>
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Tunefold</div>
        <h1 className="text-3xl font-semibold tracking-tight">Zalijepi Spotify link</h1>
        <p className="max-w-md text-sm text-muted">Playlista, album ili pjesma. Prvo dobiješ pregled i prijedloge za uredne izvođače, pa biraš što skidaš.</p>
      </div>

      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (url.trim()) onSubmit(url.trim()) }}>
        <div className="relative flex-1">
          <Link2 size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://open.spotify.com/playlist/…"
            className={`${inputCls} py-3 pl-9 text-base`} />
        </div>
        <Button type="submit" variant="primary" loading={busy} className="px-5">Pregledaj <ArrowRight size={16} /></Button>
      </form>
      {error && <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}

      {recent.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted"><Clock size={14} /> Nedavno</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {recent.map((r) => (
              <button key={r.url} onClick={() => onSubmit(r.url)} disabled={busy}
                className="flex items-center gap-3 rounded-xl border border-line bg-panel p-3 text-left transition hover:bg-panel-2">
                <Cover url={r.cover_url} size={44} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{r.name}</div>
                  <div className="truncate text-xs text-muted">{r.kind === 'album' ? 'Album' : r.kind === 'track' ? 'Pjesma' : 'Playlista'}{r.owner ? ` · ${r.owner}` : ''}{r.total ? ` · ${r.total} pjesama` : ''}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
