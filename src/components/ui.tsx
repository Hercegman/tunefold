import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

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
    <button className={`${base} ${v[variant]} ${className}`} disabled={loading || rest.disabled} {...rest}>
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
