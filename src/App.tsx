import { useCallback, useEffect, useState } from 'react'
import { Loader2, Settings as SettingsIcon } from 'lucide-react'
import { api } from './api'
import { ensureBackend } from './backend'
import { log } from './log'
import { DownloadView } from './components/DownloadView'
import { Home } from './components/Home'
import { Preview, type StartPayload } from './components/Preview'
import { SettingsDialog } from './components/SettingsDialog'
import { Button } from './components/ui'
import type { Preview as PreviewT, Settings } from './types'

type View = { name: 'home' } | { name: 'preview' } | { name: 'download'; jobId: string }

export default function App() {
  const [boot, setBoot] = useState<'loading' | 'ready' | string>('loading')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [view, setView] = useState<View>({ name: 'home' })
  const [data, setData] = useState<PreviewT | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [lastPayload, setLastPayload] = useState<StartPayload | null>(null)

  useEffect(() => {
    (async () => {
      try {
        await ensureBackend((s) => setBoot(s))
        setSettings(await api.settings())
        setBoot('ready')
      } catch (e) {
        log('error', `boot: ${e instanceof Error ? e.message : String(e)}`)
        setBoot(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [])

  const preview = useCallback(async (u: string) => {
    setBusy(true); setError(null)
    try {
      const d = await api.preview(u)
      setUrl(u); setData(d); setView({ name: 'preview' })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }, [])

  const start = useCallback(async (p: StartPayload) => {
    if (!data) return
    setBusy(true); setError(null)
    try {
      const job = await api.createJob({ url, playlist: data.playlist, ...p })
      setLastPayload(p)
      setView({ name: 'download', jobId: job.id })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }, [data, url])

  const retry = useCallback((ids: string[]) => {
    if (!lastPayload) return
    start({ ...lastPayload, track_ids: ids, save_aliases: [] })
  }, [lastPayload, start])

  if (boot !== 'ready' || !settings) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted">
        {boot === 'loading' || boot.endsWith('…') ? <><Loader2 className="spin" /> {boot === 'loading' ? 'Starting…' : boot}</> : (
          <div className="max-w-md rounded-xl border border-danger/40 bg-danger/10 p-5 text-center text-danger">
            <div className="font-medium">Could not start the backend</div>
            <div className="mt-1 text-sm">{boot}</div>
            <Button className="mt-4" onClick={() => window.location.reload()}>Try again</Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {view.name === 'home' && (
        <>
          <div className="flex justify-end px-4 pt-3">
            <Button variant="ghost" onClick={() => setShowSettings(true)}><SettingsIcon size={16} /> Settings</Button>
          </div>
          <Home onSubmit={preview} busy={busy} error={error} />
        </>
      )}
      {view.name === 'preview' && data && (
        <Preview data={data} settings={settings} starting={busy}
          onBack={() => { setView({ name: 'home' }); setError(null) }}
          onStart={start} onOpenSettings={() => setShowSettings(true)} />
      )}
      {view.name === 'download' && data && (
        <DownloadView jobId={view.jobId} playlist={data.playlist} onRetry={retry}
          onBack={() => preview(url)} />
      )}
      {error && view.name !== 'home' && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg border border-danger/40 bg-panel px-4 py-2 text-sm text-danger shadow-xl" onClick={() => setError(null)}>{error}</div>
      )}
      {showSettings && <SettingsDialog settings={settings} onChange={setSettings} onClose={() => setShowSettings(false)} />}
    </div>
  )
}
