/** Finding out that a new Tunefold is out, and becoming it.
 *
 *  The releases carry a `latest.json` that the Tauri updater reads, and every
 *  updater artifact is signed with a key that only the release workflow has.
 *  Nothing is installed that this build cannot verify, and nothing is
 *  installed without the user saying so.
 */
import { isTauri } from './backend'
import { log } from './log'

export interface Release {
  version: string
  /** The release notes, as the workflow wrote them. */
  notes: string | null
  date: string | null
  /** False for a `.deb` or `.rpm` install: apt and dnf own those files. */
  installable: boolean
}

/** What a running download is doing, for the progress bar. */
export interface Progress {
  downloaded: number
  /** Bytes, when the server said; 0 when it did not. */
  total: number
}

/** The handle the banner keeps, so Install works on what Check found. */
interface Found {
  release: Release
  install: (onProgress: (p: Progress) => void) => Promise<void>
}

/** The version the user said "later" to, so one refusal is not asked twice. */
const DISMISSED = 'tunefold.update.dismissed'

export function wasDismissed(version: string): boolean {
  try { return localStorage.getItem(DISMISSED) === version } catch { return false }
}

export function dismissUpdate(version: string): void {
  try { localStorage.setItem(DISMISSED, version) } catch { /* private mode */ }
}

/** Whether this build can replace itself - see `can_self_update` in Rust. */
async function installable(): Promise<boolean> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<boolean>('can_self_update')
  } catch {
    return false
  }
}

/** Ask the release endpoint whether there is anything newer.
 *
 *  Returns null when there is not, and when the question cannot be asked at
 *  all: a machine that is offline, or behind a proxy that eats the request, is
 *  not a machine that should be shown an error about updates it did not ask
 *  for. The reason goes to the log instead. */
export async function checkForUpdate(): Promise<Found | null> {
  if (!isTauri()) return null
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (!update?.available) {
      log('info', 'update check: already current')
      return null
    }
    log('info', `update available: ${update.version}`)
    const release: Release = {
      version: update.version,
      notes: update.body?.trim() || null,
      date: update.date ?? null,
      installable: await installable(),
    }
    return {
      release,
      install: async (onProgress) => {
        let downloaded = 0
        let total = 0
        await update.downloadAndInstall((event) => {
          if (event.event === 'Started') {
            total = event.data.contentLength ?? 0
            onProgress({ downloaded: 0, total })
          } else if (event.event === 'Progress') {
            downloaded += event.data.chunkLength
            onProgress({ downloaded, total })
          } else if (event.event === 'Finished') {
            onProgress({ downloaded: total || downloaded, total })
          }
        })
        log('info', `update ${update.version} installed, restarting`)
        const { relaunch } = await import('@tauri-apps/plugin-process')
        await relaunch()
      },
    }
  } catch (e) {
    log('warn', `update check failed: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

export type { Found as FoundUpdate }
