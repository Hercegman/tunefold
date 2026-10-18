/** Make sure the Python backend is running. In the Tauri build we spawn it as a
 *  sidecar; in plain `npm run dev` we expect it to be started manually (dev.sh). */
import { api, PORT } from './api'
import { log } from './log'

declare global {
  interface Window { __TAURI_INTERNALS__?: unknown }
}

export const isTauri = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__

async function alive(): Promise<boolean> {
  try { return (await api.health()).ok } catch { return false }
}

let spawned = false

export async function ensureBackend(onStatus?: (s: string) => void): Promise<void> {
  log('info', `ensureBackend: tauri=${isTauri()}`)
  if (await alive()) return
  if (isTauri() && !spawned) {
    spawned = true
    onStatus?.('Starting background service…')
    const { Command } = await import('@tauri-apps/plugin-shell')
    const cmd = Command.sidecar('binaries/backend', ['--port', String(PORT)])
    cmd.stderr.on('data', (l: string) => log('warn', `[backend] ${l}`))
    cmd.stdout.on('data', (l: string) => log('info', `[backend] ${l}`))
    cmd.on('close', (d) => log('warn', `[backend] exited with code ${d.code}`))
    cmd.on('error', (e) => log('error', `[backend] error: ${e}`))
    try {
      const child = await cmd.spawn()
      log('info', `[backend] sidecar started, pid ${child.pid}`)
    } catch (e) {
      log('error', `[backend] spawn failed: ${e instanceof Error ? e.message : String(e)}`)
      throw e
    }
  }
  for (let i = 0; i < 60; i++) {
    if (await alive()) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Backend is not responding on port ${PORT}. In dev mode run ./dev.sh.`)
}

export async function pickFolder(current: string): Promise<string | null> {
  if (!isTauri()) {
    const v = window.prompt('Download folder:', current)
    return v && v.trim() ? v.trim() : null
  }
  const { open } = await import('@tauri-apps/plugin-dialog')
  const r = await open({ directory: true, multiple: false, defaultPath: current })
  return typeof r === 'string' ? r : null
}

export async function revealPath(path: string): Promise<void> {
  if (!isTauri()) return
  const { revealItemInDir, openPath } = await import('@tauri-apps/plugin-opener')
  try { await revealItemInDir(path) } catch { await openPath(path) }
}
