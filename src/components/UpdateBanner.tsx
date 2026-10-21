import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowUpCircle, ExternalLink, Loader2, X } from 'lucide-react'
import { dismissUpdate, type FoundUpdate, type Progress } from '../update'
import { Button } from './ui'

const RELEASES = 'https://github.com/Hercegman/tunefold/releases/latest'

const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`

/** A strip above everything else: what is out, what changed, and one button.
 *
 *  Nothing downloads until it is pressed, and a `.deb` or `.rpm` install is
 *  told where to get the new one instead of being offered an install it must
 *  not do behind its package manager's back. */
export function UpdateBanner({ found, onClose }: { found: FoundUpdate; onClose: () => void }) {
  const { version, notes, installable } = found.release
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  // Esc is "later" here too, as long as nothing is being downloaded.
  useEffect(() => {
    if (busy) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { dismissUpdate(version); onClose() } }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [busy, version, onClose])

  const install = async () => {
    setBusy(true); setError(null)
    try {
      await found.install(setProgress)
    } catch (e) {
      setBusy(false)
      setProgress(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const openReleases = async () => {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(RELEASES)
    } catch { /* nothing else to try */ }
  }

  const pct = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
    : null

  return (
    <div className="shrink-0 border-b border-accent/30 bg-accent/10">
      <div className="flex items-start gap-3 px-4 py-2.5">
        <ArrowUpCircle size={18} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="text-sm">
            <span className="font-medium">Tunefold {version} is out.</span>{' '}
            {installable
              ? <span className="text-muted">It can install itself and restart.</span>
              : <span className="text-muted">This copy was installed by your package manager, so update it there.</span>}
            {notes && (
              <button onClick={() => setOpen(!open)} className="ml-1 text-accent underline-offset-2 hover:underline">
                {open ? 'Hide notes' : "What's new"}
              </button>
            )}
          </div>
          {open && notes && (
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-panel px-3 py-2 text-xs text-muted">
              {notes}
            </pre>
          )}
          {busy && (
            <div className="mt-2">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-accent transition-[width]"
                  style={{ width: pct === null ? '100%' : `${pct}%` }} />
              </div>
              <div className="mt-1 text-xs tabular-nums text-muted">
                {progress && progress.total > 0
                  ? `${mb(progress.downloaded)} of ${mb(progress.total)}`
                  : 'Downloading…'}
                {' · Tunefold will restart itself when it is done.'}
              </div>
            </div>
          )}
          {error && (
            <div className="mt-2 flex items-start gap-2 text-xs text-danger">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>Could not install the update: {error}</span>
            </div>
          )}
        </div>

        {!busy && (
          <div className="flex shrink-0 items-center gap-1">
            {installable
              ? <Button variant="primary" onClick={install}>Install and restart</Button>
              : <Button variant="outline" onClick={openReleases}><ExternalLink size={14} /> Releases</Button>}
            <Button variant="ghost" title="Later (Esc)" aria-label="Later" className="px-2"
              onClick={() => { dismissUpdate(version); onClose() }}><X size={16} /></Button>
          </div>
        )}
        {busy && <Loader2 size={16} className="mt-1 shrink-0 spin text-accent" />}
      </div>
    </div>
  )
}
