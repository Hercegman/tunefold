import { useCallback, useEffect, useState } from 'react'
import { BadgeCheck, Check, Loader2, Search } from 'lucide-react'
import { api, fmtSeconds, fmtViews } from '../api'
import type { YtCandidate } from '../types'
import { Badge, inputCls } from './ui'

const TAG_LABEL: Record<string, string> = {
  live: 'Live', remix: 'Remix', altered: 'Edited', cover: 'Cover',
  lyrics: 'Lyric video', full: 'Full album',
}

/** The uploads a track could have come from.
 *
 *  The automatic pick follows the source duration, which is right nearly every
 *  time and wrong in one memorable way: for a song whose famous recording is
 *  the live one, the studio take wins and the view count says otherwise. This
 *  is where that gets overruled, and the choice is remembered for next time. */
export function VersionPicker({ jobId, trackId, chosen, seed, onPicked }: {
  jobId: string
  trackId: string
  chosen?: string
  seed?: YtCandidate[]
  onPicked: () => void
}) {
  const [list, setList] = useState<YtCandidate[]>(seed || [])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback((q?: string) => {
    setLoading(true); setError(null)
    api.trackVersions(jobId, trackId, q)
      .then((r) => setList(r.candidates))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [jobId, trackId])

  // A wider search than the download itself ran, so the live take that the
  // first query never returned is actually on the list.
  useEffect(() => { load() }, [load])

  const pick = async (c: YtCandidate) => {
    setBusy(c.id); setError(null)
    try {
      await api.chooseVersion(jobId, trackId, c)
      onPicked()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(null) }
  }

  return (
    <div className="mt-2 rounded-lg border border-line bg-bg p-2">
      <form className="relative mb-2" onSubmit={(e) => { e.preventDefault(); load(query.trim() || undefined) }}>
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search YouTube differently, or paste a link"
          className={`${inputCls} py-1.5 pl-8 text-xs`} />
      </form>

      {loading && <div className="flex items-center gap-2 px-1 py-3 text-xs text-muted"><Loader2 size={13} className="spin" /> Looking for other uploads…</div>}
      {error && <div className="px-1 py-2 text-xs text-danger">{error}</div>}
      {!loading && !error && list.length === 0 && <div className="px-1 py-3 text-xs text-muted">Nothing else turned up.</div>}

      <div className="max-h-72 overflow-auto">
        {list.map((c) => {
          const current = c.id === chosen
          return (
            <button key={c.id} onClick={() => pick(c)} disabled={busy !== null}
              className={`flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition
                ${current ? 'bg-accent/10' : 'hover:bg-panel-2'} disabled:opacity-60`}>
              <span className={`mt-1 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border
                ${current ? 'border-accent bg-accent text-accent-fg' : 'border-line'}`}>
                {busy === c.id ? <Loader2 size={9} className="spin" /> : current ? <Check size={9} /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-medium">{c.title}</span>
                  {c.tags.map((t) => (
                    <Badge key={t} tone={t === 'lyrics' ? 'muted' : 'warn'}>{TAG_LABEL[t] || t}</Badge>
                  ))}
                  {!c.eligible && <Badge tone="danger">Other length</Badge>}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                  <span className="tabular-nums">{fmtSeconds(c.duration)}</span>
                  {c.off !== null && c.off > 2 && <span className="tabular-nums">({c.off > 0 ? '+' : ''}{Math.round(c.off)}s)</span>}
                  <span>·</span>
                  <span className="tabular-nums">{fmtViews(c.views)} views</span>
                  {c.channel && <><span>·</span><span className="truncate">{c.channel}</span></>}
                  {c.verified && <BadgeCheck size={11} className="shrink-0 text-info" />}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
