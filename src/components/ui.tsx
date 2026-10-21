import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { ArrowLeft, Disc3, Loader2, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { fmtSeconds } from '../api'
import type { PlayerState } from '../player'
import { SeekBar } from './Transport'

type Variant = 'primary' | 'ghost' | 'danger' | 'outline'

export function Button({ variant = 'outline', className = '', loading, children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  const base = 'inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition ' +
    'disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60'
  const v: Record<Variant, string> = {
    primary: 'bg-accent text-accent-fg hover:brightness-110',
    ghost: 'text-muted hover:text-fg hover:bg-panel-2',
    danger: 'bg-danger/15 text-danger hover:bg-danger/25',
    outline: 'border border-line bg-panel hover:bg-panel-2',
  }
  return (
    <button className={`${base} ${v[variant]} ${className}`} {...rest} disabled={loading || rest.disabled}>
      {loading && <Loader2 size={16} className="spin" />}
      {children}
    </button>
  )
}

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'accent' | 'warn' | 'danger' | 'info' }) {
  const t = {
    muted: 'bg-panel-2 text-muted',
    accent: 'bg-accent/15 text-accent',
    warn: 'bg-warn/15 text-warn',
    danger: 'bg-danger/15 text-danger',
    info: 'bg-info/15 text-info',
  }[tone]
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      {children}
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </label>
  )
}

export const inputCls = 'w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg placeholder:text-muted/60 ' +
  'focus:outline-none focus:border-accent/60'

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-bg px-3 py-2 text-left text-sm hover:bg-panel-2">
      <span>{label}</span>
      <span className={`relative h-5 w-9 rounded-full transition ${checked ? 'bg-accent' : 'bg-line'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

export function Cover({ url, size = 40, rounded = 'rounded-md' }: { url: string | null | undefined; size?: number; rounded?: string }) {
  return url
    ? <img src={url} width={size} height={size} className={`${rounded} shrink-0 object-cover bg-panel-2`} alt="" loading="lazy" />
    : <div style={{ width: size, height: size }} className={`${rounded} shrink-0 bg-panel-2`} />
}

export function BackButton({ onClick, className = '' }: { onClick: () => void; className?: string }) {
  return (
    <Button variant="ghost" onClick={onClick} title="Back (Esc)" aria-label="Back" className={`px-2 ${className}`}>
      <ArrowLeft size={18} />
    </Button>
  )
}

/** The bar along the bottom of every screen but the collection: enough of a
 *  player to follow the track and move around in it without going back. */
export function NowPlaying({ player, onOpen }: { player: PlayerState; onOpen: () => void }) {
  const track = player.current
  if (!track) return null
  return (
    <div className="shrink-0 border-t border-line bg-panel">
      <div className="flex items-center gap-3 px-4 py-2">
        <button onClick={player.prev} aria-label="Previous" title="Previous (P)"
          className="shrink-0 text-muted transition hover:text-fg"><SkipBack size={15} /></button>
        <button onClick={player.toggle} aria-label={player.playing ? 'Pause' : 'Play'} title="Play / pause (Space)"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition hover:brightness-110">
          {player.playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
        </button>
        <button onClick={player.next} aria-label="Next" title="Next (N)" disabled={!player.hasNext}
          className="shrink-0 text-muted transition hover:text-fg disabled:opacity-30"><SkipForward size={15} /></button>
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="truncate text-sm font-medium">{track.title}</div>
          <div className="truncate text-xs text-muted">{track.artist}</div>
        </button>
        <div className="hidden w-32 shrink-0 items-center gap-2 sm:flex">
          <SeekBar thin label="Position in the track" disabled={player.duration <= 0}
            value={player.progress} onChange={(v) => player.seek(v * player.duration)} />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted">
          {fmtSeconds(player.time)} / {fmtSeconds(player.duration)}
        </span>
        <Button variant="ghost" onClick={onOpen} title="Open the turntable">
          <Disc3 size={15} className={player.playing ? 'spin' : ''} />
        </Button>
      </div>
    </div>
  )
}
