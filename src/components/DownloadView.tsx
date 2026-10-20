import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ExternalLink, FolderOpen, Loader2, RotateCcw, Square, XCircle } from 'lucide-react'
import { api, baseName, jobEvents } from '../api'
import { revealPath } from '../backend'
import type { JobSnapshot, Playlist, TrackState, TrackStatus } from '../types'
import { BackButton, Badge, Button, Cover } from './ui'

const STATUS: Record<TrackStatus, { label: string; tone: 'muted' | 'accent' | 'warn' | 'danger' | 'info' }> = {
  queued: { label: 'Queued', tone: 'muted' },
  metadata: { label: 'Metadata', tone: 'info' },
  searching: { label: 'Searching YouTube', tone: 'info' },
  downloading: { label: 'Downloading', tone: 'info' },
  converting: { label: 'Converting', tone: 'info' },
  tagging: { label: 'Tags and cover', tone: 'info' },
  done: { label: 'Done', tone: 'accent' },
  skipped: { label: 'Already exists', tone: 'accent' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'warn' },
}

export function DownloadView({ jobId, playlist, onBack, onRetry }: {
  jobId: string; playlist: Playlist; onBack: () => void; onRetry: (ids: string[]) => void
}) {
  const [snap, setSnap] = useState<JobSnapshot | null>(null)
  const [tracks, setTracks] = useState<Record<string, TrackState>>({})

  useEffect(() => {
    setTracks({}); setSnap(null)
    const stop = jobEvents(jobId, (ev) => {
      const type = ev.type as string
      if (type === 'snapshot' || type === 'job' || type === 'end') {
        const s = ev as unknown as JobSnapshot
        setSnap(s)
        setTracks(Object.fromEntries(s.tracks.map((t) => [t.id, t])))
      } else if (type === 'track') {
        const t = ev as unknown as TrackState
        setTracks((x) => ({ ...x, [t.id]: { ...x[t.id], ...t } }))
      }
    })
    return stop
  }, [jobId])

  const covers = useMemo(() => Object.fromEntries(playlist.tracks.map((t) => [t.id, t.cover_url || playlist.cover_url])), [playlist])
  const list = Object.values(tracks)
  const done = list.filter((t) => t.status === 'done' || t.status === 'skipped').length
  const failed = list.filter((t) => t.status === 'failed')
  const total = snap?.total || list.length || 1
  const pct = Math.round(((done + failed.length) / total) * 100)
  const running = !snap || snap.status === 'running'

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line px-6 py-5">
        <div className="flex items-center gap-4">
          <BackButton onClick={onBack} className="-ml-2" />
          <Cover url={playlist.cover_url} size={56} rounded="rounded-lg" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold tracking-tight">{playlist.name}</h1>
            <div className="mt-0.5 flex items-center gap-2 text-sm text-muted">
              {running ? <Loader2 size={14} className="spin" /> : snap?.status === 'cancelled' ? <AlertTriangle size={14} className="text-warn" /> : <CheckCircle2 size={14} className="text-accent" />}
              <span>{done} / {total} done{failed.length ? `, ${failed.length} failed` : ''}</span>
            </div>
          </div>
          <div className="flex gap-2">
            {snap?.folder && <Button onClick={() => revealPath(snap.folder!)}><FolderOpen size={16} /> Open folder</Button>}
            {running
              ? <Button variant="danger" onClick={() => api.cancelJob(jobId)}><Square size={14} /> Stop</Button>
              : failed.length > 0 && <Button variant="primary" onClick={() => onRetry(failed.map((t) => t.id))}><RotateCcw size={16} /> Retry failed ({failed.length})</Button>}
          </div>
        </div>
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
          <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-3">
        {list.map((t) => {
          const s = STATUS[t.status]
          const active = ['metadata', 'searching', 'downloading', 'converting', 'tagging'].includes(t.status)
          return (
            <div key={t.id} className="flex items-center gap-3 border-b border-line/60 py-2.5">
              <Cover url={covers[t.id]} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{t.title}</span>
                  <span className="truncate text-sm text-muted">· {t.artist}</span>
                </div>
                <div className="mt-0.5 truncate text-xs text-muted">
                  {t.status === 'failed' ? <span className="text-danger">{t.error}</span>
                    : t.yt_title ? <span className="inline-flex items-center gap-1">YouTube: {t.yt_title}{t.yt_url && <a href={t.yt_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-muted hover:text-fg"><ExternalLink size={11} /></a>}</span>
                    : t.file ? baseName(t.file) : ''}
                </div>
                {active && (
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-panel-2">
                    <div className={`h-full rounded-full bg-info transition-all ${t.status !== 'downloading' ? 'animate-pulse' : ''}`} style={{ width: `${t.status === 'downloading' ? t.progress : (t.status === 'tagging' || t.status === 'converting') ? 99 : 8}%` }} />
                  </div>
                )}
              </div>
              <div className="w-36 text-right">
                {t.status === 'done' || t.status === 'skipped' ? <span className="inline-flex items-center gap-1 text-xs text-accent"><CheckCircle2 size={14} /> {s.label}</span>
                  : t.status === 'failed' ? <span className="inline-flex items-center gap-1 text-xs text-danger"><XCircle size={14} /> {s.label}</span>
                  : <Badge tone={s.tone}>{s.label}{t.status === 'downloading' ? ` ${t.progress}%` : ''}</Badge>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
