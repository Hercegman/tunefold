import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, Disc3, FolderOpen, Library, Loader2, MoreHorizontal, Pencil,
  Play, Plus, Trash2, X,
} from 'lucide-react'
import { api, baseName, coverUrl } from '../api'
import type { PlayerState } from '../player'
import type { CollectionTrack, UserCollection } from '../types'
import { BackButton, Button, inputCls } from './ui'
import { Transport } from './Transport'
import { Turntable } from './Turntable'

/** The sidebar is the point of the whole app: one entry per artist, under the
 *  folded name the user confirmed, not the credit the source printed. */
function group(tracks: CollectionTrack[]): { artist: string; tracks: CollectionTrack[] }[] {
  const by = new Map<string, CollectionTrack[]>()
  for (const t of tracks) {
    const list = by.get(t.artist)
    if (list) list.push(t)
    else by.set(t.artist, [t])
  }
  return [...by.entries()]
    .map(([artist, list]) => ({ artist, tracks: list }))
    .sort((a, b) => a.artist.localeCompare(b.artist))
}

/** The folder an opened queue came from, for the heading above it. */
function folderOf(tracks: CollectionTrack[]): string {
  const dir = tracks[0]?.file.replace(/[\\/][^\\/]*$/, '')
  return dir ? baseName(dir) : 'Opened files'
}

/** What can be done to one track, from wherever it is listed. */
interface TrackActions {
  collections: UserCollection[]
  /** The collection the track is listed under right now, if any. */
  within?: UserCollection
  add: (track: CollectionTrack, to: number) => void
  move: (track: CollectionTrack, from: number, to: number) => void
  remove: (track: CollectionTrack, from: number) => void
  deleteFile: (track: CollectionTrack) => void
}

/** A small menu pinned to the button that opened it. Fixed, not absolute, so
 *  the scrolling sidebar cannot clip it. */
function TrackMenu({ track, anchor, actions, onClose }: {
  track: CollectionTrack
  anchor: DOMRect
  actions: TrackActions
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [confirm, setConfirm] = useState(false)
  const { collections, within } = actions
  const member = new Set(track.collections || [])
  const targets = collections.filter((c) => c.id !== within?.id)

  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key, true) }
  }, [onClose])

  const top = Math.min(anchor.bottom + 4, window.innerHeight - 320)
  const item = 'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition hover:bg-panel-2'

  return (
    <div ref={ref} style={{ top, left: Math.min(anchor.left, window.innerWidth - 240) }}
      className="fixed z-50 w-56 rounded-lg border border-line bg-panel p-1 shadow-xl">
      <div className="truncate px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-muted">
        {within ? 'Move to' : 'Add to collection'}
      </div>
      <div className="max-h-44 overflow-y-auto">
        {targets.length === 0 && <div className="px-2.5 py-1.5 text-xs text-muted">No {within ? 'other ' : ''}collections yet</div>}
        {targets.map((c) => (
          <button key={c.id} className={item} disabled={!within && member.has(c.id)}
            onClick={() => { if (within) actions.move(track, within.id, c.id); else actions.add(track, c.id); onClose() }}>
            <Library size={12} className="shrink-0 text-muted" />
            <span className="truncate">{c.name}</span>
            {member.has(c.id) && <Check size={12} className="ml-auto shrink-0 text-accent" />}
          </button>
        ))}
      </div>
      <div className="my-1 border-t border-line" />
      {within && (
        <button className={item} onClick={() => { actions.remove(track, within.id); onClose() }}>
          <X size={12} className="shrink-0 text-muted" />
          <span className="truncate">Remove from {within.name}</span>
        </button>
      )}
      {confirm ? (
        <div className="px-2.5 py-1.5 text-xs">
          <div className="text-danger">Delete the file from disk? This cannot be undone.</div>
          <div className="mt-1.5 flex gap-1.5">
            <Button variant="danger" className="px-2.5 py-1 text-xs" onClick={() => { actions.deleteFile(track); onClose() }}>Delete</Button>
            <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => setConfirm(false)}>Keep</Button>
          </div>
        </div>
      ) : (
        <button className={`${item} text-danger`} onClick={() => setConfirm(true)}>
          <Trash2 size={12} className="shrink-0" /> Delete file…
        </button>
      )}
    </div>
  )
}

function TrackRow({ track, playing, current, onPlay, actions, indent = 'pl-8' }: {
  track: CollectionTrack
  playing: boolean
  current: boolean
  onPlay: () => void
  /** Left out for files opened from the desktop: they are not Tunefold's to file or delete. */
  actions?: TrackActions
  indent?: string
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const close = useCallback(() => setAnchor(null), [])
  return (
    <div className={`group flex items-center transition
      ${current ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-panel-2 hover:text-fg'}`}>
      <button onClick={onPlay} title={track.title}
        className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 ${indent} text-left text-xs`}>
        {current && playing ? <Disc3 size={12} className="shrink-0 spin" /> : <Play size={10} className="shrink-0 opacity-50" />}
        <span className="truncate">{track.title}</span>
      </button>
      {actions && (
        <button aria-label="Track actions" title="Move, remove or delete"
          onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())}
          className={`mr-1.5 shrink-0 rounded p-1 text-muted transition hover:bg-line/60 hover:text-fg
            ${anchor ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}>
          <MoreHorizontal size={13} />
        </button>
      )}
      {anchor && actions && <TrackMenu track={track} anchor={anchor} actions={actions} onClose={close} />}
    </div>
  )
}

/** Name a new collection, or rename one, in place. */
function NameInput({ initial = '', placeholder, onSubmit, onCancel }: {
  initial?: string
  placeholder: string
  onSubmit: (name: string) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (!name.trim()) return
    try { await onSubmit(name) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  return (
    <form className="px-3 py-1.5" onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <div className="flex items-center gap-1">
        <input autoFocus value={name} placeholder={placeholder} onChange={(e) => { setName(e.target.value); setError(null) }}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }}
          className={`${inputCls} py-1 text-xs`} />
        <button type="submit" aria-label="Save" disabled={!name.trim()}
          className="shrink-0 rounded p-1 text-accent hover:bg-panel-2 disabled:opacity-40"><Check size={14} /></button>
        <button type="button" aria-label="Cancel" onClick={onCancel}
          className="shrink-0 rounded p-1 text-muted hover:bg-panel-2 hover:text-fg"><X size={14} /></button>
      </div>
      {error && <div className="mt-1 text-xs text-danger">{error}</div>}
    </form>
  )
}

function CollectionHeader({ c, count, expanded, onToggle, onRename, onDelete }: {
  c: UserCollection
  count: number
  expanded: boolean
  onToggle: () => void
  onRename: (name: string) => Promise<void>
  onDelete: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [confirm, setConfirm] = useState(false)
  if (renaming) {
    return <NameInput initial={c.name} placeholder="Collection name" onCancel={() => setRenaming(false)}
      onSubmit={async (n) => { await onRename(n); setRenaming(false) }} />
  }
  return (
    <div className="group flex items-center hover:bg-panel-2">
      <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-3 text-left text-sm">
        {expanded ? <ChevronDown size={13} className="shrink-0 text-muted" /> : <ChevronRight size={13} className="shrink-0 text-muted" />}
        <span className="truncate">{c.name}</span>
      </button>
      {confirm ? (
        <div className="flex shrink-0 items-center gap-1 pr-2 text-xs">
          <span className="text-danger">Delete?</span>
          <button aria-label="Delete collection" onClick={onDelete} className="rounded p-1 text-danger hover:bg-danger/15"><Check size={13} /></button>
          <button aria-label="Keep collection" onClick={() => setConfirm(false)} className="rounded p-1 text-muted hover:text-fg"><X size={13} /></button>
        </div>
      ) : (
        <>
          <span className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
            <button aria-label="Rename" title="Rename" onClick={() => setRenaming(true)}
              className="rounded p-1 text-muted hover:text-fg"><Pencil size={12} /></button>
            <button aria-label="Delete collection" title="Delete the collection (the files stay)" onClick={() => setConfirm(true)}
              className="rounded p-1 text-muted hover:text-danger"><Trash2 size={12} /></button>
          </span>
          <span className="w-8 shrink-0 pr-3 text-right text-xs tabular-nums text-muted">{count}</span>
        </>
      )}
    </div>
  )
}

type Tab = 'artists' | 'collections'
const TAB_KEY = 'tunefold.collectionTab'

export function Collection({ player, onBack }: { player: PlayerState; onBack: () => void }) {
  const [tracks, setTracks] = useState<CollectionTrack[] | null>(null)
  const [mine, setMine] = useState<UserCollection[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [openCollection, setOpenCollection] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [swapping, setSwapping] = useState(false)
  const [tab, setTabState] = useState<Tab>(() => {
    try { return localStorage.getItem(TAB_KEY) === 'collections' ? 'collections' : 'artists' } catch { return 'artists' }
  })
  const setTab = (t: Tab) => {
    setTabState(t)
    try { localStorage.setItem(TAB_KEY, t) } catch { /* no storage */ }
  }

  const reload = useCallback(async () => {
    try {
      const [t, c] = await Promise.all([api.collection(), api.collections()])
      setTracks(t); setMine(c)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const artists = useMemo(() => group(tracks || []), [tracks])
  const byCollection = useMemo(() => {
    const m = new Map<number, CollectionTrack[]>()
    for (const t of tracks || []) for (const id of t.collections || []) {
      const list = m.get(id)
      if (list) list.push(t)
      else m.set(id, [t])
    }
    return m
  }, [tracks])
  const current = player.current
  const currentFile = current?.file
  const currentArtist = current?.artist

  /** A queue of files opened from the desktop is not in the library, so it
   *  gets a section of its own rather than going unlisted. */
  const opened = useMemo(() => {
    const known = new Set((tracks || []).map((t) => t.file))
    return player.queue.some((t) => !known.has(t.file)) ? player.queue : []
  }, [tracks, player.queue])

  // The record change is choreography, not a gate: the next track is already
  // playing underneath it.
  useEffect(() => {
    if (!currentFile) return
    setSwapping(true)
    const t = setTimeout(() => setSwapping(false), 650)
    return () => clearTimeout(t)
  }, [currentFile])

  useEffect(() => {
    if (currentArtist) setOpen(currentArtist)
  }, [currentArtist])

  /** Run a change, then read the library again: the backend is the record. */
  const change = useCallback(async (fn: () => Promise<unknown>) => {
    setNotice(null)
    try { await fn() } catch (e) { setNotice(e instanceof Error ? e.message : String(e)) }
    await reload()
  }, [reload])

  const actionsFor = (within?: UserCollection): TrackActions => ({
    collections: mine,
    within,
    add: (t, to) => change(() => api.addToCollection(to, [t.file])),
    move: (t, from, to) => change(() => api.moveBetweenCollections(from, to, [t.file])),
    remove: (t, from) => change(() => api.removeFromCollection(from, [t.file])),
    deleteFile: (t) => change(async () => {
      // Off the deck first: on Windows a file that is still being streamed
      // cannot be deleted.
      player.drop([t.file])
      const r = await api.deleteTracks([t.file])
      if (r.failed[t.file]) throw new Error(`Could not delete ${baseName(t.file)}: ${r.failed[t.file]}`)
    }),
  })

  const playAll = () => tracks?.length && player.play(tracks, 0)

  const tabCls = (t: Tab) => `flex-1 rounded-md px-2 py-1 text-xs font-medium transition
    ${tab === t ? 'bg-panel-2 text-fg' : 'text-muted hover:text-fg'}`

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex items-center gap-2 border-b border-line px-3 py-3">
          <BackButton onClick={onBack} className="-ml-1" />
          <span className="text-sm font-medium">Collection</span>
          {tracks && <span className="ml-auto text-xs text-muted">{tracks.length}</span>}
        </div>
        <div className="flex gap-1 border-b border-line p-1.5" role="tablist">
          <button role="tab" aria-selected={tab === 'artists'} className={tabCls('artists')} onClick={() => setTab('artists')}>Artists</button>
          <button role="tab" aria-selected={tab === 'collections'} className={tabCls('collections')} onClick={() => setTab('collections')}>
            My collections{mine.length > 0 && <span className="ml-1 tabular-nums text-muted">{mine.length}</span>}
          </button>
        </div>
        {notice && (
          <div className="flex items-start gap-2 border-b border-line bg-danger/10 px-3 py-2 text-xs text-danger" onClick={() => setNotice(null)}>
            <AlertTriangle size={13} className="mt-0.5 shrink-0" /><span>{notice}</span>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {opened.length > 0 && (
            <div className="mb-1 border-b border-line pb-1">
              <div className="flex items-center gap-1.5 px-3 py-1.5 text-sm">
                <FolderOpen size={13} className="shrink-0 text-muted" />
                <span className="truncate" title={folderOf(opened)}>{folderOf(opened)}</span>
                <span className="ml-auto shrink-0 text-xs tabular-nums text-muted">{opened.length}</span>
              </div>
              {opened.map((t, i) => (
                <TrackRow key={t.file} track={t} current={currentFile === t.file} playing={player.playing}
                  onPlay={() => player.play(opened, i)} />
              ))}
            </div>
          )}
          {!tracks && !error && <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted"><Loader2 size={13} className="spin" /> Reading your library…</div>}
          {error && <div className="px-3 py-4 text-xs text-danger">{error}</div>}

          {tab === 'artists' && (
            <>
              {tracks?.length === 0 && <div className="px-3 py-4 text-xs text-muted">Nothing downloaded yet. Paste a link and the files land here.</div>}
              {artists.map(({ artist, tracks: list }) => {
                const expanded = open === artist
                return (
                  <div key={artist}>
                    <button onClick={() => setOpen(expanded ? null : artist)}
                      className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-sm hover:bg-panel-2">
                      {expanded ? <ChevronDown size={13} className="shrink-0 text-muted" /> : <ChevronRight size={13} className="shrink-0 text-muted" />}
                      <span className="truncate">{artist}</span>
                      <span className="ml-auto shrink-0 text-xs tabular-nums text-muted">{list.length}</span>
                    </button>
                    {expanded && list.map((t) => (
                      <TrackRow key={t.file} track={t} current={currentFile === t.file} playing={player.playing}
                        onPlay={() => player.play(list, list.indexOf(t))} actions={actionsFor()} />
                    ))}
                  </div>
                )
              })}
            </>
          )}

          {tab === 'collections' && tracks && (
            <>
              {adding ? (
                <NameInput placeholder="New collection" onCancel={() => setAdding(false)}
                  onSubmit={async (name) => {
                    const c = await api.createCollection(name)
                    setAdding(false); setOpenCollection(c.id)
                    await reload()
                  }} />
              ) : (
                <button onClick={() => setAdding(true)}
                  className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-sm text-muted hover:bg-panel-2 hover:text-fg">
                  <Plus size={13} className="shrink-0" /> New collection
                </button>
              )}
              {mine.length === 0 && !adding && (
                <div className="px-3 py-3 text-xs text-muted">
                  Collections are your own groupings. Pick one before a download, or add tracks from the
                  Artists tab with the <MoreHorizontal size={11} className="inline" /> button.
                </div>
              )}
              {mine.map((c) => {
                const list = byCollection.get(c.id) || []
                const expanded = openCollection === c.id
                return (
                  <div key={c.id}>
                    <CollectionHeader c={c} count={list.length} expanded={expanded}
                      onToggle={() => setOpenCollection(expanded ? null : c.id)}
                      onRename={async (name) => { await api.renameCollection(c.id, name); await reload() }}
                      onDelete={() => change(() => api.deleteCollection(c.id))} />
                    {expanded && list.length === 0 && <div className="py-1.5 pl-8 text-xs text-muted">Empty</div>}
                    {expanded && list.length > 0 && (
                      <button onClick={() => player.play(list, 0)}
                        className="flex w-full items-center gap-2 py-1.5 pl-8 text-left text-xs text-accent hover:bg-panel-2">
                        <Play size={10} className="shrink-0" /> Play {c.name}
                      </button>
                    )}
                    {expanded && list.map((t, i) => (
                      <TrackRow key={t.file} track={t} current={currentFile === t.file} playing={player.playing}
                        onPlay={() => player.play(list, i)} actions={actionsFor(c)} />
                    ))}
                  </div>
                )
              })}
            </>
          )}
        </div>
        {tracks && tracks.length > 0 && (
          <div className="border-t border-line p-2">
            <Button className="w-full justify-center" onClick={playAll}><Play size={14} /> Play everything</Button>
          </div>
        )}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 p-6">
        <div className="min-h-0 w-full max-w-2xl flex-1">
          <Turntable cover={current ? coverUrl(current.file) : null} progress={player.progress}
            playing={player.playing} swapping={swapping} trackKey={current?.file || ''}
            title={current?.title} artist={current?.artist}
            onSeek={(p) => player.seek(p * player.duration)}
            onToggle={player.toggle} />
        </div>

        <div className="w-full max-w-md">
          <div className="text-center">
            <div className="truncate text-lg font-semibold tracking-tight">{current?.title || 'Nothing playing'}</div>
            <div className="truncate text-sm text-muted">
              {current ? `${current.artist}${current.album ? ` · ${current.album}` : ''}` : 'Pick something from the left'}
            </div>
          </div>
          <div className="mt-3">
            <Transport player={player} />
          </div>
          {player.error && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-left text-xs text-danger">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{player.error}</span>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
