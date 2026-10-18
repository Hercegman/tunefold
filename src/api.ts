import type { Alias, JobSnapshot, Preview, Recent, Settings } from './types'

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
  preview: (url: string) => req<Preview>('/api/preview', { method: 'POST', body: JSON.stringify({ url }) }),
  settings: () => req<Settings>('/api/settings'),
  saveSettings: (patch: Partial<Settings>) => req<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  recent: () => req<Recent[]>('/api/recent'),
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
  es.onerror = () => { /* EventSource se sam reconnecta */ }
  return () => es.close()
}

export function fmtDuration(ms: number | null | undefined): string {
  if (!ms) return '–'
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
