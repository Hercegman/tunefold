/** Files handed to Tunefold by the desktop: "Open with", a double-clicked
 *  MP3, or a path on the command line.
 *
 *  The shell collects them on the Rust side - at launch from argv, later from
 *  the single-instance hook when the user opens a second file while Tunefold
 *  is already running - and keeps them until the window asks. Asking is the
 *  only way they are read, so a window that was still booting when the files
 *  arrived still gets them, and gets them exactly once.
 */
import { isTauri } from './backend'
import { log } from './log'

/** Emitted by the shell when files arrive at an app that is already running. */
const OPEN_EVENT = 'tunefold://open-files'

/** Everything the shell has been given and the window has not taken yet. */
export async function takeOpenedFiles(): Promise<string[]> {
  if (!isTauri()) return []
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const paths = await invoke<string[]>('take_opened_files')
    if (paths.length) log('info', `opened from the desktop: ${paths.join(', ')}`)
    return paths
  } catch (e) {
    log('error', `take_opened_files: ${e instanceof Error ? e.message : String(e)}`)
    return []
  }
}

/** Call `onPaths` for the files Tunefold was started with, and again for every
 *  set the desktop sends afterwards. Returns the unsubscribe. */
export async function watchOpenedFiles(onPaths: (paths: string[]) => void): Promise<() => void> {
  const first = await takeOpenedFiles()
  if (first.length) onPaths(first)
  if (!isTauri()) return () => {}
  try {
    const { listen } = await import('@tauri-apps/api/event')
    // The event is only a nudge: the paths themselves come from the drain, so
    // a nudge that arrives twice cannot play anything twice.
    return await listen(OPEN_EVENT, () => {
      takeOpenedFiles().then((paths) => { if (paths.length) onPaths(paths) })
    })
  } catch (e) {
    log('error', `open-files listener: ${e instanceof Error ? e.message : String(e)}`)
    return () => {}
  }
}
