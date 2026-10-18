/** Log to the console and, in the Tauri build, to stdout + the app log file. */
import { isTauri } from './backend'

type Level = 'info' | 'warn' | 'error'
let plugin: Promise<typeof import('@tauri-apps/plugin-log')> | null = null

export function log(level: Level, msg: string) {
  console[level](msg)
  if (!isTauri()) return
  plugin ??= import('@tauri-apps/plugin-log')
  plugin.then((p) => (level === 'info' ? p.info(msg) : level === 'warn' ? p.warn(msg) : p.error(msg))).catch(() => {})
}
