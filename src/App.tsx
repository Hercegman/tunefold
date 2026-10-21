import { useCallback, useEffect, useRef, useState } from 'react'
import { Disc3, Loader2, Settings as SettingsIcon } from 'lucide-react'
import { api } from './api'
import { ensureBackend } from './backend'
import { log } from './log'
import { useNav } from './nav'
import { watchOpenedFiles } from './openwith'
import { usePlayer, usePlayerKeys } from './player'
import { checkForUpdate, wasDismissed, type FoundUpdate } from './update'
import { Collection } from './components/Collection'
import { DownloadView } from './components/DownloadView'
import { Home } from './components/Home'
import { Preview, type StartPayload } from './components/Preview'
import { SettingsDialog } from './components/SettingsDialog'
import { UpdateBanner } from './components/UpdateBanner'
import { Button, NowPlaying } from './components/ui'
import type { Preview as PreviewT, Settings } from './types'

type View = { name: 'home' } | { name: 'preview' } | { name: 'download'; jobId: string } | { name: 'collection' }

export default function App() {
  const [boot, setBoot] = useState<'loading' | 'ready' | string>('loading')
  const [settings, setSettings] = useState<Settings | null>(null)
  const { view, depth, go, replace, back } = useNav<View>({ name: 'home' })
  const [data, setData] = useState<PreviewT | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [lastPayload, setLastPayload] = useState<StartPayload | null>(null)
  const [job, setJob] = useState<{ id: string; playlistId: string } | null>(null)
  const [update, setUpdate] = useState<FoundUpdate | null>(null)
  const player = usePlayer()
  usePlayerKeys(player)
  // The open-with handler must not be rebuilt every time the clock ticks, so
  // it reads the current view through a ref rather than closing over it.
  const viewRef = useRef(view)
  useEffect(() => { viewRef.current = view }, [view])

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

  /** Files the desktop handed over: an MP3 opened with Tunefold, or a path on
   *  the command line. The backend queues the rest of the folder behind a
   *  single file, so opening one track plays the album it sits in. */
  const openFiles = useCallback(async (paths: string[]) => {
    try {
      const { tracks, start } = await api.external(paths)
      if (!tracks.length) return
      player.play(tracks, start)
      if (viewRef.current.name !== 'collection') go({ name: 'collection' })
    } catch (e) {
      log('error', `open: ${e instanceof Error ? e.message : String(e)}`)
      setError(`Could not open that file: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [player, go])

  // Only once the backend is up, because it is the backend that reads the
  // files - and nothing is lost by waiting, since the shell holds the paths
  // until they are asked for. The listener is registered once, through a ref,
  // so the clock ticking does not tear it down and build it again.
  const openRef = useRef(openFiles)
  useEffect(() => { openRef.current = openFiles }, [openFiles])
  useEffect(() => {
    if (boot !== 'ready') return
    let stop: (() => void) | undefined
    let gone = false
    watchOpenedFiles((paths) => openRef.current(paths)).then((off) => { if (gone) off(); else stop = off })
    return () => { gone = true; stop?.() }
  }, [boot])

  /** Is there a newer Tunefold? Asked once, after the app is up and out of
   *  the way of starting: the answer is a strip at the top, never a dialog,
   *  and a version the user has already waved off is not mentioned again. */
  useEffect(() => {
    if (boot !== 'ready' || !settings?.check_updates) return
    let gone = false
    checkForUpdate().then((found) => {
      if (!gone && found && !wasDismissed(found.release.version)) setUpdate(found)
    })
    return () => { gone = true }
  }, [boot, settings?.check_updates])

  // Escape goes back one view, unless a dialog or a text field wants it first.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || showSettings || depth <= 1) return
      const el = document.activeElement as HTMLInputElement | null
      const typing = !!el && (el.isContentEditable || el.tagName === 'SELECT' ||
        (el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'radio'))
      if (typing) return
      back()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [showSettings, depth, back])

  const preview = useCallback(async (u: string) => {
    setBusy(true); setError(null)
    try {
      const d = await api.preview(u)
      setUrl(u); setData(d); go({ name: 'preview' })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }, [go])

  const start = useCallback(async (p: StartPayload) => {
    if (!data) return
    setBusy(true); setError(null)
    try {
      const created = await api.createJob({ url, playlist: data.playlist, ...p })
      setLastPayload(p)
      setJob({ id: created.id, playlistId: data.playlist.id })
      // Retrying from the download screen replaces it instead of stacking a
      // second one, so Back still leads to the playlist.
      const next: View = { name: 'download', jobId: created.id }
      if (view.name === 'download') replace(next)
      else go(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }, [data, url, view, go, replace])

  /** Artwork that arrived after the preview rendered. Patching it into the
   *  playlist here means the download screen and the job payload get it too. */
  const fillCovers = useCallback((covers: Record<string, string>) => {
    setData((d) => d && ({
      ...d,
      playlist: {
        ...d.playlist,
        tracks: d.playlist.tracks.map((t) => (covers[t.id] ? { ...t, cover_url: covers[t.id] } : t)),
      },
    }))
  }, [])

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
      {update && <UpdateBanner found={update} onClose={() => setUpdate(null)} />}
      {view.name === 'home' && (
        <>
          <div className="flex justify-end gap-1 px-4 pt-3">
            <Button variant="ghost" onClick={() => go({ name: 'collection' })}><Disc3 size={16} /> Collection</Button>
            <Button variant="ghost" onClick={() => setShowSettings(true)}><SettingsIcon size={16} /> Settings</Button>
          </div>
          <Home url={url} onUrlChange={setUrl} onSubmit={preview} busy={busy} error={error}
            settings={settings} onOpenSettings={() => setShowSettings(true)}
            onOpenCollection={() => go({ name: 'collection' })} />
        </>
      )}
      {view.name === 'preview' && data && (
        <Preview data={data} settings={settings} starting={busy}
          onBack={back} onStart={start} onOpenSettings={() => setShowSettings(true)}
          onOpenJob={job && job.playlistId === data.playlist.id
            ? () => go({ name: 'download', jobId: job.id }) : undefined}
          onCovers={fillCovers} />
      )}
      {view.name === 'download' && data && (
        <DownloadView jobId={view.jobId} playlist={data.playlist} onRetry={retry} onBack={back}
          onOpenCollection={() => go({ name: 'collection' })} />
      )}
      {view.name === 'collection' && <Collection player={player} onBack={back} />}
      {error && view.name !== 'home' && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg border border-danger/40 bg-panel px-4 py-2 text-sm text-danger shadow-xl" onClick={() => setError(null)}>{error}</div>
      )}
      {view.name !== 'collection' && (
        <NowPlaying player={player} onOpen={() => go({ name: 'collection' })} />
      )}
      {showSettings && <SettingsDialog settings={settings} onChange={setSettings} onClose={() => setShowSettings(false)} />}
    </div>
  )
}
