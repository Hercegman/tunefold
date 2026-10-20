import type { Alias, JobSnapshot, Preview, Recent, Settings, Stats } from './types'

export const PORT = 8765
export const BASE = `http://127.0.0.1:${PORT}`

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  })
  if (!r.ok) {
    let msg = `HTTP ${r.status}`
    try {
      const j = await r.json()
      msg = j.detail || msg
    } catch { /* ignore */ }
    throw new Error(msg)
  }
  return r.json() as Promise<T>
}

export const api = {
  health: () => req<{ ok: boolean; ffmpeg: boolean; version: string }>('/api/health'),
  sources: () => req<Record<string, string>>('/api/sources'),
  preview: (url: string) => req<Preview>('/api/preview', { method: 'POST', body: JSON.stringify({ url }) }),
  settings: () => req<Settings>('/api/settings'),
  saveSettings: (patch: Partial<Settings>) => req<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  recent: () => req<Recent[]>('/api/recent'),
  stats: () => req<Stats>('/api/stats'),
  aliases: () => req<Alias[]>('/api/aliases'),
  deleteAlias: (key: string) => req<{ ok: boolean }>(`/api/aliases/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  createJob: (body: unknown) => req<JobSnapshot>('/api/jobs', { method: 'POST', body: JSON.stringify(body) }),
  cancelJob: (id: string) => req<{ ok: boolean }>(`/api/jobs/${id}/cancel`, { method: 'POST' }),
  job: (id: string) => req<JobSnapshot>(`/api/jobs/${id}`),
}

export function jobEvents(id: string, onEvent: (ev: Record<string, unknown>) => void): () => void {
  const es = new EventSource(`${BASE}/api/jobs/${id}/events`)
  es.onmessage = (m) => {
    try { onEvent(JSON.parse(m.data)) } catch { /* ignore */ }
  }
  es.onerror = () => { /* EventSource reconnects on its own */ }
  return () => es.close()
}

/** Join a path the way the host OS writes it: out_dir comes from the backend,
 *  so on Windows it arrives with backslashes. */
export function joinPath(base: string, ...parts: string[]): string {
  const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/'
  return [base.replace(/[\\/]+$/, ''), ...parts].join(sep)
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

export function fmtDuration(ms: number | null | undefined): string {
  if (!ms) return '–'
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
