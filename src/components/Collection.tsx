import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Disc3, FolderOpen, Loader2, Play } from 'lucide-react'
import { api, baseName, coverUrl } from '../api'
import type { PlayerState } from '../player'
import type { CollectionTrack } from '../types'
import { BackButton, Button } from './ui'
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

function TrackRow({ track, playing, current, onPlay, indent = 'pl-8' }: {
  track: CollectionTrack
  playing: boolean
  current: boolean
  onPlay: () => void
  indent?: string
}) {
  return (
    <button onClick={onPlay} title={track.title}
      className={`flex w-full items-center gap-2 py-1.5 ${indent} pr-3 text-left text-xs transition
        ${current ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-panel-2 hover:text-fg'}`}>
      {current && playing ? <Disc3 size={12} className="shrink-0 spin" /> : <Play size={10} className="shrink-0 opacity-50" />}
      <span className="truncate">{track.title}</span>
    </button>
  )
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
                    onPlay={() => player.play(list, list.indexOf(t))} />
                ))}
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
