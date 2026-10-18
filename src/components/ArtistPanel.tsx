import { useState } from 'react'
import { Check, ChevronDown, ChevronRight, Pencil, Sparkles, Users, X } from 'lucide-react'
import type { Suggestion } from '../types'
import { Badge, inputCls } from './ui'

export interface Decision { accepted: boolean; to: string }

const KIND: Record<Suggestion['kind'], { label: string; tone: 'accent' | 'info' | 'warn' | 'muted' }> = {
  merge: { label: 'Spajanje', tone: 'accent' },
  feat: { label: 'Gost (feat.)', tone: 'info' },
  spelling: { label: 'Zapis', tone: 'warn' },
  alias: { label: 'Spremljeno pravilo', tone: 'muted' },
}

export function ArtistPanel({ suggestions, decisions, onChange }: {
  suggestions: Suggestion[]
  decisions: Record<string, Decision>
  onChange: (id: string, d: Decision) => void
}) {
  const [open, setOpen] = useState(true)
  const active = suggestions.filter((s) => decisions[s.id]?.accepted).length
  if (suggestions.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-sm text-muted">
        <Users size={16} /> Izvođači su već uredni, nema što grupirati.
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-accent/30 bg-panel">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <Sparkles size={16} className="text-accent" />
        <span className="text-sm font-medium">Pametno grupiranje izvođača</span>
        <Badge tone="accent">{active} / {suggestions.length} aktivno</Badge>
        <span className="ml-auto text-muted">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
      </button>
      {open && (
        <div className="divide-y divide-line border-t border-line">
          {suggestions.map((s) => <Row key={s.id} s={s} d={decisions[s.id] ?? { accepted: true, to: s.to }} onChange={(d) => onChange(s.id, d)} />)}
        </div>
      )}
    </div>
  )
}

function Row({ s, d, onChange }: { s: Suggestion; d: Decision; onChange: (d: Decision) => void }) {
  const [editing, setEditing] = useState(false)
  const k = KIND[s.kind]
  return (
    <div className={`flex items-start gap-3 px-4 py-3 ${d.accepted ? '' : 'opacity-60'}`}>
      <button onClick={() => onChange({ ...d, accepted: !d.accepted })} title={d.accepted ? 'Isključi' : 'Uključi'}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition ${d.accepted ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-bg text-transparent'}`}>
        <Check size={14} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <Badge tone={k.tone}>{k.label}</Badge>
          <span className="text-muted">{s.sources.join(' · ')}</span>
          <span className="text-muted">→</span>
          {editing ? (
            <input autoFocus className={`${inputCls} w-64 py-1`} value={d.to}
              onChange={(e) => onChange({ ...d, to: e.target.value })}
              onBlur={() => setEditing(false)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditing(false) }} />
          ) : (
            <button onClick={() => setEditing(true)} className="group inline-flex items-center gap-1 font-medium hover:text-accent">
              {d.to} <Pencil size={12} className="opacity-0 transition group-hover:opacity-100" />
            </button>
          )}
          {s.alternatives.length > 0 && (
            <select className="rounded-md border border-line bg-bg px-2 py-0.5 text-xs" value="" onChange={(e) => e.target.value && onChange({ ...d, to: e.target.value })}>
              <option value="">ili…</option>
              {s.alternatives.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
        </div>
        <div className="mt-1 text-xs text-muted">
          {s.track_ids.length} {s.track_ids.length === 1 ? 'pjesma' : 'pjesme'} · {s.reason}
        </div>
      </div>
      {!d.accepted && <X size={14} className="mt-1 text-muted" />}
    </div>
  )
}
