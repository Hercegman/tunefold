import { useCallback, useRef, useState } from 'react'
import { Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react'
import { fmtSeconds } from '../api'
import type { PlayerState } from '../player'

/** A bar that can be dragged, clicked and driven from the keyboard.
 *
 *  One component for the position in a track and for the volume: both are a
 *  number between 0 and 1 that the user needs to see and to set, and both have
 *  to keep following the pointer after it leaves the bar - which is what the
 *  pointer capture is for. */
export function SeekBar({ value, onChange, onScrub, label, format, thin, disabled, className = '' }: {
  value: number
  onChange: (v: number) => void
  /** Called while dragging, for a preview that does not commit yet. */
  onScrub?: (v: number) => void
  label: string
  /** Renders the tooltip above the bar while dragging. */
  format?: (v: number) => string
  thin?: boolean
  disabled?: boolean
  className?: string
}) {
  const track = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const shown = drag ?? value
  const pct = `${Math.max(0, Math.min(1, shown)) * 100}%`

  const at = useCallback((clientX: number): number => {
    const box = track.current?.getBoundingClientRect()
    if (!box || box.width === 0) return 0
    return Math.max(0, Math.min(1, (clientX - box.left) / box.width))
  }, [])

  const step = (delta: number) => onChange(Math.max(0, Math.min(1, value + delta)))

  return (
    <div
      ref={track}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown * 100)}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      className={`group relative flex touch-none items-center ${thin ? 'h-2' : 'h-4'} ${className}
        ${disabled ? 'pointer-events-none opacity-40' : 'cursor-pointer'}
        focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded-full`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        const v = at(e.clientX)
        setDrag(v)
        onScrub?.(v)
      }}
      onPointerMove={(e) => {
        if (drag === null) return
        const v = at(e.clientX)
        setDrag(v)
        onScrub?.(v)
      }}
      onPointerUp={(e) => {
        if (drag === null) return
        const v = at(e.clientX)
        setDrag(null)
        onChange(v)
      }}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); step(0.02) }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); step(-0.02) }
        else if (e.key === 'Home') { e.preventDefault(); onChange(0) }
        else if (e.key === 'End') { e.preventDefault(); onChange(1) }
      }}
    >
      <div className={`w-full overflow-hidden rounded-full bg-line ${thin ? 'h-1' : 'h-1.5'}`}>
        <div className="h-full rounded-full bg-accent" style={{ width: pct }} />
      </div>
      {/* The handle only shows up when it is wanted: on hover, on focus, and
          for as long as the bar is being dragged. */}
      <div className={`pointer-events-none absolute h-3 w-3 -translate-x-1/2 rounded-full bg-fg shadow transition-opacity
          ${drag !== null ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}`}
        style={{ left: pct }} />
      {format && drag !== null && (
        <div className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded-md border border-line bg-panel-2
            px-1.5 py-0.5 text-[11px] tabular-nums text-fg shadow-lg" style={{ left: pct }}>
          {format(shown)}
        </div>
      )}
    </div>
  )
}

const REPEAT_TITLE = {
  off: 'Repeat off (R)',
  all: 'Repeating the queue (R)',
  one: 'Repeating this track (R)',
} as const

function Volume({ player }: { player: PlayerState }) {
  const [open, setOpen] = useState(false)
  const level = player.muted ? 0 : player.volume
  const Icon = level === 0 ? VolumeX : level < 0.5 ? Volume1 : Volume2
  return (
    <div className="flex items-center gap-2" onPointerEnter={() => setOpen(true)} onPointerLeave={() => setOpen(false)}>
      <button onClick={player.toggleMute} title={player.muted ? 'Unmute (M)' : 'Mute (M)'}
        aria-label={player.muted ? 'Unmute' : 'Mute'}
        className="text-muted transition hover:text-fg"><Icon size={17} /></button>
      <div className={`transition-all ${open ? 'w-20 opacity-100' : 'w-0 opacity-0'} overflow-hidden`}>
        <SeekBar thin label="Volume" value={level} onChange={player.setVolume} />
      </div>
    </div>
  )
}

/** The transport: where you are in the track, and every way of changing it. */
export function Transport({ player }: { player: PlayerState }) {
  const loaded = !!player.current
  const seekable = loaded && player.duration > 0
  const [scrub, setScrub] = useState<number | null>(null)
  const shown = scrub !== null ? scrub * player.duration : player.time
  const RepeatIcon = player.repeat === 'one' ? Repeat1 : Repeat

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 text-xs tabular-nums text-muted">
        <span className="w-10 shrink-0 text-right">{fmtSeconds(loaded ? shown : null)}</span>
        <SeekBar className="flex-1" label="Position in the track" disabled={!seekable}
          value={player.progress}
          format={(v) => fmtSeconds(v * player.duration)}
          onScrub={(v) => setScrub(v)}
          onChange={(v) => { setScrub(null); player.seek(v * player.duration) }} />
        <span className="w-10 shrink-0">{fmtSeconds(loaded ? player.duration : null)}</span>
      </div>

      <div className="mt-2 flex items-center">
        <div className="flex flex-1 justify-start">
          <Volume player={player} />
        </div>

        <div className="flex items-center gap-3">
          <button onClick={player.toggleShuffle} disabled={!loaded} title="Shuffle (S)" aria-pressed={player.shuffle}
            className={`rounded-md p-1.5 transition disabled:opacity-30
              ${player.shuffle ? 'bg-accent/15 text-accent' : 'text-muted hover:text-fg'}`}>
            <Shuffle size={16} />
          </button>
          <button onClick={player.prev} disabled={!loaded} title="Previous (P)" aria-label="Previous"
            className="text-muted transition hover:text-fg disabled:opacity-30"><SkipBack size={20} /></button>
          <button onClick={player.toggle} disabled={!loaded} title="Play / pause (Space)"
            aria-label={player.playing ? 'Pause' : 'Play'}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-fg transition hover:brightness-110 disabled:opacity-30">
            {player.playing ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
          </button>
          <button onClick={player.next} disabled={!player.hasNext} title="Next (N)" aria-label="Next"
            className="text-muted transition hover:text-fg disabled:opacity-30"><SkipForward size={20} /></button>
          <button onClick={player.cycleRepeat} disabled={!loaded} title={REPEAT_TITLE[player.repeat]}
            aria-pressed={player.repeat !== 'off'}
            className={`rounded-md p-1.5 transition disabled:opacity-30
              ${player.repeat !== 'off' ? 'bg-accent/15 text-accent' : 'text-muted hover:text-fg'}`}>
            <RepeatIcon size={16} />
          </button>
        </div>

        <div className="flex flex-1 justify-end text-xs tabular-nums text-muted">
          {player.order.length > 1 && (
            <span title={player.shuffle ? 'Playing in shuffled order' : 'Playing in queue order'}>
              {player.order.indexOf(player.index) + 1} / {player.order.length}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
