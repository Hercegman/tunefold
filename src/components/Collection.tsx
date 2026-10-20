import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Disc3, Loader2, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { api, coverUrl, fmtSeconds } from '../api'
import type { PlayerState } from '../player'
import type { CollectionTrack } from '../types'
import { BackButton, Button } from './ui'
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

export function Collection({ player, onBack }: { player: PlayerState; onBack: () => void }) {
  const [tracks, setTracks] = useState<CollectionTrack[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [swapping, setSwapping] = useState(false)

  useEffect(() => {
    api.collection().then(setTracks).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const artists = useMemo(() => group(tracks || []), [tracks])
  const current = player.current
  const currentFile = current?.file
  const currentArtist = current?.artist

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

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.isContentEditable)) return
      if (e.key === ' ') { e.preventDefault(); player.toggle() }
      else if (e.key === 'ArrowRight') player.seek(player.time + 5)
      else if (e.key === 'ArrowLeft') player.seek(player.time - 5)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [player])

  const playAll = () => tracks?.length && player.play(tracks, 0)

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex items-center gap-2 border-b border-line px-3 py-3">
          <BackButton onClick={onBack} className="-ml-1" />
          <span className="text-sm font-medium">Collection</span>
          {tracks && <span className="ml-auto text-xs text-muted">{tracks.length}</span>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {!tracks && !error && <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted"><Loader2 size={13} className="spin" /> Reading your library…</div>}
          {error && <div className="px-3 py-4 text-xs text-danger">{error}</div>}
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
                {expanded && list.map((t) => {
                  const on = current?.file === t.file
                  return (
                    <button key={t.file} onClick={() => player.play(list, list.indexOf(t))}
                      className={`flex w-full items-center gap-2 py-1.5 pl-8 pr-3 text-left text-xs transition
                        ${on ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-panel-2 hover:text-fg'}`}>
                      {on && player.playing ? <Disc3 size={12} className="shrink-0 spin" /> : <Play size={10} className="shrink-0 opacity-50" />}
                      <span className="truncate">{t.title}</span>
                    </button>
                  )
                })}
              </div>
            )
          })}
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
            onSeek={(p) => player.seek(p * player.duration)} />
        </div>

        <div className="w-full max-w-md text-center">
          <div className="truncate text-lg font-semibold tracking-tight">{current?.title || 'Nothing playing'}</div>
          <div className="truncate text-sm text-muted">
            {current ? `${current.artist}${current.album ? ` · ${current.album}` : ''}` : 'Pick something from the left'}
          </div>
          <div className="mt-3 flex items-center justify-center gap-5">
            <button onClick={player.prev} disabled={!current}
              className="text-muted transition hover:text-fg disabled:opacity-30"><SkipBack size={20} /></button>
            <button onClick={player.toggle} disabled={!current}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-fg transition hover:brightness-110 disabled:opacity-30">
              {player.playing ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
            </button>
            <button onClick={player.next} disabled={player.index + 1 >= player.queue.length}
              className="text-muted transition hover:text-fg disabled:opacity-30"><SkipForward size={20} /></button>
          </div>
          <div className="mt-2 flex items-center justify-center gap-2 text-xs tabular-nums text-muted">
            <span>{fmtSeconds(player.time)}</span><span>/</span><span>{fmtSeconds(player.duration)}</span>
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
