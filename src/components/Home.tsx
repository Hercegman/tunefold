import { useEffect, useState } from 'react'
import { ArrowRight, Clock, Disc3, Download, FolderOpen, Link2, Play, Sparkles } from 'lucide-react'
import { api } from '../api'
import { LINK_RE, SOURCE_NAMES, SOURCES, sourceLabel } from '../sources'
import type { Recent, Settings, Stats } from '../types'
import { Logo } from './Logo'
import { Badge, Button, Cover, inputCls } from './ui'

const FOLDER_LABEL: Record<Settings['folder_mode'], string> = {
  playlist: 'one folder per playlist',
  artist: 'Artist/',
  'artist-album': 'Artist/Album/',
}

function ago(ts: number | null): string | null {
  if (!ts) return null
  const d = Math.floor((Date.now() / 1000 - ts) / 86400)
  if (d <= 0) return 'today'
  if (d === 1) return 'yesterday'
  if (d < 30) return `${d} days ago`
  const m = Math.floor(d / 30)
  return m < 12 ? `${m} month${m > 1 ? 's' : ''} ago` : `${Math.floor(m / 12)} year${m >= 24 ? 's' : ''} ago`
}

const STEPS = [
  { icon: Link2, title: 'Paste a link', body: 'A playlist, album or single track from Spotify, Deezer or Apple Music. No account, no API key.' },
  { icon: Sparkles, title: 'Confirm the folding', body: 'Messy artist credits collapse into one name per artist. You decide each one.' },
  { icon: Download, title: 'Get tagged files', body: 'MP3, M4A, Opus, FLAC or WAV with tags and cover art, in the layout you chose.' },
]

function Steps() {
  return (
    <section className="grid gap-3 sm:grid-cols-3">
      {STEPS.map((s, i) => (
        <div key={s.title} className="rounded-xl border border-line bg-panel p-4">
          <div className="mb-2 flex items-center gap-2">
            <s.icon size={15} className="text-accent" />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Step {i + 1}</span>
          </div>
          <div className="text-sm font-medium">{s.title}</div>
          <p className="mt-1 text-xs leading-relaxed text-muted">{s.body}</p>
        </div>
      ))}
    </section>
  )
}

function StatRow({ stats }: { stats: Stats }) {
  const cells = [
    { n: stats.tracks, label: stats.tracks === 1 ? 'track' : 'tracks' },
    { n: stats.artists, label: stats.artists === 1 ? 'artist' : 'artists' },
    { n: stats.aliases, label: stats.aliases === 1 ? 'artist rule' : 'artist rules' },
  ]
  const last = ago(stats.last)
  return (
    <section className="rounded-xl border border-line bg-panel">
      <div className="grid grid-cols-3 divide-x divide-line">
        {cells.map((c) => (
          <div key={c.label} className="px-4 py-3 text-center">
            <div className="text-2xl font-semibold tabular-nums tracking-tight">{c.n.toLocaleString()}</div>
            <div className="text-xs text-muted">{c.label}</div>
          </div>
        ))}
      </div>
      {last && <div className="border-t border-line px-4 py-2 text-center text-xs text-muted">Last download {last}</div>}
    </section>
  )
}

export function Home({ url, onUrlChange, onSubmit, busy, error, settings, onOpenSettings, onOpenCollection }: {
  url: string
  onUrlChange: (url: string) => void
  onSubmit: (url: string) => void
  busy: boolean
  error: string | null
  settings: Settings
  onOpenSettings: () => void
  onOpenCollection: () => void
}) {
  const [recent, setRecent] = useState<Recent[]>([])
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    api.recent().then(setRecent).catch(() => {})
    api.stats().then(setStats).catch(() => {})
  }, [])

  useEffect(() => {
    // paste anywhere -> fill input
    const h = (e: ClipboardEvent) => {
      const t = e.clipboardData?.getData('text') || ''
      if (LINK_RE.test(t) && (document.activeElement as HTMLElement)?.tagName !== 'INPUT') onUrlChange(t.trim())
    }
    window.addEventListener('paste', h)
    return () => window.removeEventListener('paste', h)
  }, [onUrlChange])

  const lossless = settings.format === 'flac' || settings.format === 'wav'
  const used = stats !== null && stats.tracks > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center gap-8 px-6 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <Logo size={64} />
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Tunefold</div>
        <h1 className="text-3xl font-semibold tracking-tight">Paste a playlist link</h1>
        <p className="max-w-md text-sm text-muted">A playlist, album or track. You get a preview and artist clean-up suggestions first, then pick what to download.</p>
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {SOURCE_NAMES.map((n) => <Badge key={n} tone="muted">{SOURCES[n].label}</Badge>)}
        </div>
      </div>

      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (url.trim()) onSubmit(url.trim()) }}>
        <div className="relative flex-1">
          <Link2 size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input autoFocus value={url} onChange={(e) => onUrlChange(e.target.value)} placeholder={SOURCES.spotify.example}
            className={`${inputCls} py-3 pl-9 text-base`} />
        </div>
        <Button type="submit" variant="primary" loading={busy} className="px-5">Preview <ArrowRight size={16} /></Button>
      </form>
      {error && <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}

      {stats !== null && (used ? <StatRow stats={stats} /> : <Steps />)}

      {used && stats && (
        <button onClick={onOpenCollection}
          className="group flex w-full items-center gap-4 rounded-xl border border-accent/30 bg-panel p-4 text-left transition hover:border-accent/60 hover:bg-panel-2">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition group-hover:brightness-110">
            <Play size={20} className="ml-0.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold tracking-tight">Play your collection</span>
            <span className="block text-sm text-muted">
              {stats.tracks.toLocaleString()} {stats.tracks === 1 ? 'track' : 'tracks'} · {stats.artists.toLocaleString()} {stats.artists === 1 ? 'artist' : 'artists'}, on a turntable
            </span>
          </span>
          <Disc3 size={20} className="shrink-0 text-muted transition group-hover:text-accent" />
        </button>
      )}

      {recent.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted"><Clock size={14} /> Recent</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {recent.map((r) => (
              <button key={r.url} onClick={() => onSubmit(r.url)} disabled={busy}
                className="flex items-center gap-3 rounded-xl border border-line bg-panel p-3 text-left transition hover:bg-panel-2">
                <Cover url={r.cover_url} size={44} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{r.name}</div>
                  <div className="truncate text-xs text-muted">{sourceLabel(r.source)} · {r.kind === 'album' ? 'Album' : r.kind === 'track' ? 'Track' : 'Playlist'}{r.owner ? ` · ${r.owner}` : ''}{r.total ? ` · ${r.total} ${r.total === 1 ? 'track' : 'tracks'}` : ''}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

        </div>
      </div>

      <button onClick={onOpenSettings} title="Change in Settings"
        className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-2.5 text-xs text-muted transition hover:bg-panel-2 hover:text-fg">
        <FolderOpen size={14} className="shrink-0" />
        <span className="truncate">{settings.out_dir}</span>
        <span className="ml-auto shrink-0">{settings.format.toUpperCase()}{lossless ? '' : ` ${settings.quality}`}</span>
        <span className="shrink-0 text-line">·</span>
        <span className="shrink-0">{FOLDER_LABEL[settings.folder_mode]}</span>
      </button>
    </div>
  )
}
