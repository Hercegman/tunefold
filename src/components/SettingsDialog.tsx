import { useEffect, useState } from 'react'
import { FolderOpen, Trash2, X } from 'lucide-react'
import { api } from '../api'
import { pickFolder } from '../backend'
import type { Alias, Settings } from '../types'
import { Button, Field, Switch, inputCls } from './ui'

export function SettingsDialog({ settings, onChange, onClose }: { settings: Settings; onChange: (s: Settings) => void; onClose: () => void }) {
  const [s, setS] = useState<Settings>(settings)
  const [aliases, setAliases] = useState<Alias[]>([])
  const [tab, setTab] = useState<'general' | 'aliases'>('general')
  const lossless = s.format === 'flac' || s.format === 'wav'

  useEffect(() => { api.aliases().then(setAliases).catch(() => {}) }, [])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const save = async () => { onChange(await api.saveSettings(s)); onClose() }
  const preview = (() => {
    const a = 'Silk Sonic', t = 'Leave the Door Open', ext = s.format
    const stem = s.naming === 'artist-title' ? `${a} - ${t}` : s.naming === 'title-artist' ? `${t} - ${a}` : t
    return `${s.track_numbers ? '07. ' : ''}${stem}.${ext}`
  })()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="flex max-h-full w-full max-w-2xl flex-col rounded-2xl border border-line bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-4 border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold">Settings</h2>
          <nav className="ml-2 flex gap-1 text-sm">
            {(['general', 'aliases'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1 ${tab === t ? 'bg-panel-2 text-fg' : 'text-muted hover:text-fg'}`}>
                {t === 'general' ? 'General' : `Artist rules (${aliases.length})`}
              </button>
            ))}
          </nav>
          <Button variant="ghost" onClick={onClose} className="ml-auto px-2"><X size={18} /></Button>
        </div>

        {tab === 'general' ? (
          <div className="grid gap-4 overflow-auto px-5 py-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Music folder">
                <div className="flex gap-2">
                  <input className={inputCls} value={s.out_dir} onChange={(e) => setS({ ...s, out_dir: e.target.value })} />
                  <Button onClick={async () => { const p = await pickFolder(s.out_dir); if (p) setS({ ...s, out_dir: p }) }}><FolderOpen size={16} /></Button>
                </div>
              </Field>
            </div>
            <Field label="Format">
              <select className={inputCls} value={s.format} onChange={(e) => setS({ ...s, format: e.target.value as Settings['format'] })}>
                <option value="mp3">MP3 (most compatible)</option>
                <option value="m4a">M4A / AAC</option>
                <option value="opus">Opus</option>
                <option value="flac">FLAC (lossless)</option>
                <option value="wav">WAV</option>
              </select>
            </Field>
            <Field label="Quality" hint={lossless ? 'Not applicable to lossless formats.' : 'The YouTube source is ~128–160 kbps; 320 adds no quality, but does no harm.'}>
              <select className={inputCls} value={s.quality} disabled={lossless} onChange={(e) => setS({ ...s, quality: e.target.value as Settings['quality'] })}>
                {['128', '192', '256', '320'].map((q) => <option key={q} value={q}>{q} kbps</option>)}
              </select>
            </Field>
            <Field label="Folder layout" hint="For alphabetical sorting by artist pick 'Artist / Album'.">
              <select className={inputCls} value={s.folder_mode} onChange={(e) => setS({ ...s, folder_mode: e.target.value as Settings['folder_mode'] })}>
                <option value="playlist">Folder per playlist</option>
                <option value="artist">Artist /</option>
                <option value="artist-album">Artist / Album /</option>
              </select>
            </Field>
            <Field label="File name" hint={preview}>
              <select className={inputCls} value={s.naming} onChange={(e) => setS({ ...s, naming: e.target.value as Settings['naming'] })}>
                <option value="artist-title">Artist - Track</option>
                <option value="title-artist">Track - Artist</option>
                <option value="title">Track only</option>
              </select>
            </Field>
            <Switch checked={s.track_numbers} onChange={(v) => setS({ ...s, track_numbers: v })} label="Track number prefix (01., 02., …)" />
            <Switch checked={s.loose_match} onChange={(v) => setS({ ...s, loose_match: v })} label="Take the closest match when strict matching fails" />
            <Field label="Parallel downloads">
              <input type="number" min={1} max={8} className={inputCls} value={s.parallel} onChange={(e) => setS({ ...s, parallel: Math.max(1, Math.min(8, Number(e.target.value) || 1)) })} />
            </Field>
            <Field label="YouTube cookies (optional)" hint="Netscape cookies.txt from your browser, only if YouTube blocks you.">
              <input className={inputCls} value={s.cookies} placeholder="/home/…/cookies.txt" onChange={(e) => setS({ ...s, cookies: e.target.value })} />
            </Field>
          </div>
        ) : (
          <div className="overflow-auto px-5 py-4">
            {aliases.length === 0 ? <p className="py-6 text-center text-sm text-muted">No saved rules yet. They are created when you accept suggestions on the playlist preview.</p> : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted"><tr><th className="py-2">Spotify credit</th><th className="py-2">Saved as</th><th /></tr></thead>
                <tbody>
                  {aliases.map((a) => (
                    <tr key={a.credit_key} className="border-t border-line/60">
                      <td className="py-2 text-muted">{a.credit}</td>
                      <td className="py-2 font-medium">{a.canonical}</td>
                      <td className="py-2 text-right"><Button variant="ghost" className="px-2" onClick={async () => { await api.deleteAlias(a.credit_key); setAliases((x) => x.filter((y) => y.credit_key !== a.credit_key)) }}><Trash2 size={15} /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>Save</Button>
        </div>
      </div>
    </div>
  )
}
