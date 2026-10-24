import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Download, FolderOpen, Library, Loader2, Settings as SettingsIcon } from 'lucide-react'
import { api, fmtDuration, joinPath } from '../api'
import { sourceLabel } from '../sources'
import type { Preview as PreviewT, Settings, UserCollection } from '../types'
import { ArtistPanel, type Decision } from './ArtistPanel'
import { BackButton, Badge, Button, Cover, inputCls } from './ui'

export interface StartPayload {
  track_ids: string[]
  artist_map: Record<string, string>
  save_aliases: { credit: string; to: string }[]
  /** One of the user's collections to file the downloads under, or none. */
  collection_id: number | null
}

const LAST_COLLECTION = 'tunefold.lastCollection'

/** Which of the user's collections the downloads go into. The last one used
 *  is offered again, since a run of playlists usually goes to the same place. */
function CollectionPicker({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const [list, setList] = useState<UserCollection[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.collections().then((l) => {
      setList(l)
      let last: number | null = null
      try { last = Number(localStorage.getItem(LAST_COLLECTION)) || null } catch { /* no storage */ }
      if (last && l.some((c) => c.id === last)) onChange(last)
    }).catch(() => setList([]))
  }, [onChange])

  const pick = (id: number | null) => {
    onChange(id)
    try { localStorage.setItem(LAST_COLLECTION, id ? String(id) : '') } catch { /* no storage */ }
  }

  const create = async () => {
    setError(null)
    try {
      const c = await api.createCollection(name)
      setList((l) => [...(l || []), c].sort((a, b) => a.name.localeCompare(b.name)))
      pick(c.id)
      setAdding(false); setName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (adding) {
    return (
      <div className="flex flex-col items-end gap-1">
        <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); void create() }}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="New collection"
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setAdding(false) } }}
            className={`${inputCls} w-48 py-1.5`} />
          <Button type="submit" disabled={!name.trim()} className="py-1.5">Create</Button>
          <Button type="button" variant="ghost" className="py-1.5" onClick={() => setAdding(false)}>Cancel</Button>
        </form>
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    )
  }

  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <Library size={13} /> Add to
      <select value={value ?? ''} disabled={!list}
        onChange={(e) => e.target.value === 'new' ? setAdding(true) : pick(e.target.value ? Number(e.target.value) : null)}
        className="rounded-md border border-line bg-bg px-2 py-1 text-xs text-fg focus:border-accent/60 focus:outline-none">
        <option value="">No collection</option>
        {list?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        <option value="new">+ New collection…</option>
      </select>
    </label>
  )
}

export function Preview({ data, settings, onBack, onStart, onOpenSettings, onOpenJob, onCovers, starting }: {
  data: PreviewT
  settings: Settings
  onBack: () => void
  onStart: (p: StartPayload) => void
  onOpenSettings: () => void
  /** Set while a download for this playlist exists, so leaving it is safe. */
  onOpenJob?: () => void
  /** Artwork that arrived after the table was already on screen. */
  onCovers: (covers: Record<string, string>) => void
  starting: boolean
}) {
  const { playlist: pl, analysis, have } = data
  const [selected, setSelected] = useState<Set<string>>(() => new Set(pl.tracks.filter((t) => !have[t.id]).map((t) => t.id)))
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() =>
    Object.fromEntries(analysis.suggestions.map((s) => [s.id, { accepted: true, to: s.to }])))
  const [remember, setRemember] = useState(true)
  const [collectionId, setCollectionId] = useState<number | null>(null)

  useEffect(() => {
    setSelected(new Set(pl.tracks.filter((t) => !have[t.id]).map((t) => t.id)))
    setDecisions(Object.fromEntries(analysis.suggestions.map((s) => [s.id, { accepted: true, to: s.to }])))
  }, [pl.id, analysis, have, pl.tracks])

  // A Spotify playlist embed lists its tracks without artwork, so the first
  // page of them would sit there wearing the playlist's own picture. Fetch the
  // real ones behind the table rather than making the table wait for them.
  // Nothing aborts this on cleanup: the artwork lands in the playlist App
  // holds, so it is still wanted if this screen is gone by the time it
  // arrives - and an effect that cancelled itself would be cancelled by
  // StrictMode's second pass and never deliver anything in development.
  const asked = useRef<string | null>(null)
  useEffect(() => {
    const missing = pl.tracks.filter((t) => !t.cover_url).map((t) => t.id)
    if (!missing.length || asked.current === pl.id) return
    asked.current = pl.id
    void (async () => {
      for (let i = 0; i < missing.length; i += 50) {
        try {
          const got = await api.covers(pl.source, missing.slice(i, i + 50))
          if (Object.keys(got).length) onCovers(got)
        } catch { return }
      }
    })()
  }, [pl.id, pl.source, pl.tracks, onCovers])

  // final artist name per track = original, then apply accepted suggestions
  const artistMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const t of pl.tracks) m[t.id] = t.credit
    for (const s of analysis.suggestions) {
      const d = decisions[s.id]
      if (!d?.accepted) continue
      for (const id of s.track_ids) m[id] = d.to
    }
    return m
  }, [pl.tracks, analysis.suggestions, decisions])

  const changed = pl.tracks.filter((t) => artistMap[t.id] !== t.credit).length
  const allSel = selected.size === pl.tracks.length
  const toggleAll = () => setSelected(allSel ? new Set() : new Set(pl.tracks.map((t) => t.id)))
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const start = () => {
    const save: { credit: string; to: string }[] = []
    if (remember) {
      for (const s of analysis.suggestions) {
        const d = decisions[s.id]
        if (!d?.accepted || s.kind === 'alias') continue
        const credits = new Set(pl.tracks.filter((t) => s.track_ids.includes(t.id)).map((t) => t.credit))
        for (const c of credits) if (c !== d.to) save.push({ credit: c, to: d.to })
      }
    }
    onStart({
      track_ids: pl.tracks.filter((t) => selected.has(t.id)).map((t) => t.id),
      artist_map: artistMap, save_aliases: save, collection_id: collectionId,
    })
  }

  const kindLabel = pl.kind === 'album' ? 'Album' : pl.kind === 'track' ? 'Track' : 'Playlist'
  const source = sourceLabel(pl.source)
  const folder = settings.folder_mode === 'playlist'
    ? joinPath(settings.out_dir, pl.kind === 'track' ? pl.name : pl.owner ? `${pl.name} - ${pl.owner}` : pl.name)
    : settings.folder_mode === 'artist' ? joinPath(settings.out_dir, '<Artist>') : joinPath(settings.out_dir, '<Artist>', '<Album>')

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start gap-5 border-b border-line px-6 py-5">
        <BackButton onClick={onBack} className="mt-1 -ml-2" />
        <Cover url={pl.cover_url} size={88} rounded="rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">{source} {kindLabel}{pl.owner ? ` · ${pl.owner}` : ''}</div>
          <h1 className="truncate text-2xl font-semibold tracking-tight">{pl.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>{pl.tracks.length} tracks</span>
            {Object.keys(have).length > 0 && <Badge tone="accent"><CheckCircle2 size={12} className="mr-1" />{Object.keys(have).length} already downloaded</Badge>}
            {changed > 0 && <Badge tone="info">{changed} with folded artist</Badge>}
          </div>
          <div className="mt-2 flex items-center gap-1.5 truncate text-xs text-muted"><FolderOpen size={13} /> {folder}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex gap-2">
            {onOpenJob && (
              <Button variant="ghost" onClick={onOpenJob} title="Back to the download for this playlist">
                <Loader2 size={14} className="spin" /> Download
              </Button>
            )}
            <Button onClick={onOpenSettings}><SettingsIcon size={16} /> {settings.format.toUpperCase()} {settings.format === 'flac' || settings.format === 'wav' ? '' : settings.quality}</Button>
            <Button variant="primary" onClick={start} disabled={selected.size === 0} loading={starting}>
              <Download size={16} /> Download {selected.size} {selected.size === 1 ? 'track' : 'tracks'}
            </Button>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-accent" />
            Remember artist decisions for future playlists
          </label>
          <CollectionPicker value={collectionId} onChange={setCollectionId} />
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="mb-4">
          <ArtistPanel suggestions={analysis.suggestions} decisions={decisions} onChange={(id, d) => setDecisions((x) => ({ ...x, [id]: d }))} />
        </div>

        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-bg text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="w-8 border-b border-line py-2 pl-2 text-left"><input type="checkbox" checked={allSel} onChange={toggleAll} className="accent-accent" /></th>
              <th className="w-10 border-b border-line py-2 text-right font-medium">#</th>
              <th className="border-b border-line py-2 pl-3 text-left font-medium">Track</th>
              <th className="border-b border-line py-2 pl-3 text-left font-medium">Artist (in file)</th>
              <th className="border-b border-line py-2 pl-3 text-left font-medium">{source} credit</th>
              <th className="w-16 border-b border-line py-2 pr-2 text-right font-medium">Length</th>
            </tr>
          </thead>
          <tbody>
            {pl.tracks.map((t, i) => {
              const sel = selected.has(t.id)
              const final = artistMap[t.id]
              const diff = final !== t.credit
              return (
                <tr key={t.id} onClick={() => toggle(t.id)} className={`row-in cursor-pointer ${sel ? '' : 'opacity-50'} hover:bg-panel`} style={{ animationDelay: `${Math.min(i, 30) * 12}ms` }}>
                  <td className="border-b border-line/60 py-2 pl-2"><input type="checkbox" checked={sel} onChange={() => toggle(t.id)} onClick={(e) => e.stopPropagation()} className="accent-accent" /></td>
                  <td className="border-b border-line/60 py-2 text-right tabular-nums text-muted">{t.position ?? i + 1}</td>
                  <td className="border-b border-line/60 py-2 pl-3">
                    <div className="flex items-center gap-3">
                      <Cover url={t.cover_url || pl.cover_url} size={36} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{t.title}</div>
                        <div className="truncate text-xs text-muted">{t.album || (have[t.id] ? 'already downloaded' : '')}</div>
                      </div>
                    </div>
                  </td>
                  <td className={`border-b border-line/60 py-2 pl-3 ${diff ? 'text-accent' : ''}`}>{final}</td>
                  <td className="border-b border-line/60 py-2 pl-3 text-muted">{t.credit}</td>
                  <td className="border-b border-line/60 py-2 pr-2 text-right tabular-nums text-muted">{fmtDuration(t.duration_ms)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
