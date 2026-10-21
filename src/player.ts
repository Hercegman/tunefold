import { useCallback, useEffect, useRef, useState } from 'react'
import { audioUrl } from './api'
import type { CollectionTrack } from './types'

/** Off: the queue ends when it ends. All: it starts over. One: this track
 *  repeats until something else is asked for. */
export type RepeatMode = 'off' | 'all' | 'one'

export interface PlayerState {
  queue: CollectionTrack[]
  /** The order the queue is being played in: positions into `queue`. */
  order: number[]
  error: string | null
  current: CollectionTrack | null
  index: number
  playing: boolean
  time: number
  duration: number
  progress: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  hasNext: boolean
  play: (queue: CollectionTrack[], index: number) => void
  toggle: () => void
  next: () => void
  prev: () => void
  seek: (seconds: number) => void
  stop: () => void
  setVolume: (v: number) => void
  toggleMute: () => void
  toggleShuffle: () => void
  cycleRepeat: () => void
}

/** Why the file would not play, in words rather than an error code.
 *
 *  Worth spelling out because the usual cause on Linux is not the app at all:
 *  the webview there decodes through GStreamer, and a machine without the
 *  plugin packages cannot play an MP3 at all, however healthy the file is. */
function describeMediaError(err: MediaError | null, file: string): string {
  const ext = (file.split('.').pop() || 'this file').toUpperCase()
  const gst = typeof navigator !== 'undefined' && /Linux/.test(navigator.userAgent)
    ? ' On Linux this window decodes audio through GStreamer - installing the GStreamer plugins'
      + ' (good, bad, ugly and libav) is what usually fixes it.'
    : ''
  switch (err?.code) {
    case 1: return 'Playback was stopped.'
    case 2: return 'The connection to the file dropped.'
    case 3:
    case 4: return `This window cannot play ${ext}.${gst}`
    default: return `Could not play ${ext}.${gst}`
  }
}

const PREFS = 'tunefold.player'

interface Prefs { volume: number; muted: boolean; shuffle: boolean; repeat: RepeatMode }

const DEFAULTS: Prefs = { volume: 1, muted: false, shuffle: false, repeat: 'off' }

/** Volume and the two modes outlive the window: a player that forgets it was
 *  on shuffle every time it starts is a player nobody trusts. */
function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS)
    if (!raw) return DEFAULTS
    const p = JSON.parse(raw) as Partial<Prefs>
    return {
      volume: typeof p.volume === 'number' ? Math.max(0, Math.min(1, p.volume)) : DEFAULTS.volume,
      muted: p.muted === true,
      shuffle: p.shuffle === true,
      repeat: p.repeat === 'all' || p.repeat === 'one' ? p.repeat : 'off',
    }
  } catch { return DEFAULTS }
}

/** Read once per session, then kept here: there is one player in the app, so
 *  there is one set of preferences, and no component has to own it. */
let cached: Prefs | null = null

const prefs = (): Prefs => (cached ??= loadPrefs())

function savePrefs(patch: Partial<Prefs>): void {
  cached = { ...prefs(), ...patch }
  try { localStorage.setItem(PREFS, JSON.stringify(cached)) } catch { /* private mode */ }
}

/** Fisher-Yates, with `first` lifted to the front: a shuffle started from a
 *  track plays that track now and the rest of the queue in some other order. */
function shuffled(n: number, first: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  const at = a.indexOf(first)
  if (at > 0) [a[0], a[at]] = [a[at], a[0]]
  return a
}

const inOrder = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

/** One <audio> element for the whole app, living outside the view tree so
 *  leaving the collection screen does not stop the music. */
export function usePlayer(): PlayerState {
  const el = useRef<HTMLAudioElement | null>(null)
  /** Built on first use - never during render - and kept for the session. */
  const media = useCallback(() => {
    if (typeof Audio === 'undefined') return null
    if (!el.current) {
      el.current = new Audio()
      el.current.volume = prefs().volume
      el.current.muted = prefs().muted
      el.current.preload = 'metadata'
    }
    return el.current
  }, [])

  const [queue, setQueue] = useState<CollectionTrack[]>([])
  /** Positions into `queue`, in the order they will be played. */
  const [order, setOrder] = useState<number[]>([])
  /** Where in `order` playback sits; -1 when nothing is loaded. */
  const [pos, setPos] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [volume, setVol] = useState(() => prefs().volume)
  const [muted, setMuted] = useState(() => prefs().muted)
  const [shuffle, setShuffle] = useState(() => prefs().shuffle)
  const [repeat, setRepeat] = useState<RepeatMode>(() => prefs().repeat)

  // Media events fire long after render, so the handlers read the queue
  // through refs instead of closing over a stale copy of it.
  const queueRef = useRef(queue)
  const orderRef = useRef(order)
  const posRef = useRef(pos)
  const repeatRef = useRef(repeat)
  useEffect(() => { queueRef.current = queue }, [queue])
  useEffect(() => { orderRef.current = order }, [order])
  useEffect(() => { posRef.current = pos }, [pos])
  useEffect(() => { repeatRef.current = repeat }, [repeat])

  /** `list` and `ord` are passed in when the queue has only just been handed
   *  over and React has not committed it yet. */
  const start = useCallback((p: number, list?: CollectionTrack[], ord?: number[]) => {
    const audio = media()
    const tracks = list ?? queueRef.current
    const places = ord ?? orderRef.current
    const track = tracks[places[p]]
    if (!audio || !track) return
    queueRef.current = tracks
    orderRef.current = places
    posRef.current = p
    audio.src = audioUrl(track.file)
    audio.play().catch((e: unknown) => {
      setPlaying(false)
      // A rejected play() with no media error of its own is the autoplay
      // policy; anything else is the file or the decoder.
      setError(audio.error ? describeMediaError(audio.error, track.file)
        : `Could not start playback: ${e instanceof Error ? e.message : String(e)}`)
    })
    setPos(p)
    setTime(0)
    setDuration(typeof track.duration === 'number' ? track.duration : 0)
    setError(null)
  }, [media])

  /** One step through the queue. `auto` is the end of a track rather than a
   *  press of the button, and only then does repeat get a say. */
  const step = useCallback((delta: number, auto: boolean) => {
    const audio = media()
    const places = orderRef.current
    if (!audio || !places.length) return
    const mode = repeatRef.current
    if (auto && mode === 'one') { start(posRef.current); return }
    const p = posRef.current + delta
    if (p >= places.length) {
      if (mode === 'all') start(0)
      // Nothing left to play: hold the last track on the deck, stopped at the
      // end, rather than clearing the screen out from under the user.
      else if (auto) { audio.pause(); setPlaying(false) }
      return
    }
    if (p < 0) {
      if (mode === 'all') start(places.length - 1)
      else audio.currentTime = 0
      return
    }
    start(p)
  }, [media, start])

  useEffect(() => {
    const audio = media()
    if (!audio) return
    const onTime = () => setTime(audio.currentTime)
    // A decoder that cannot read the file reports NaN; the duration from the
    // file's own header is better than nothing, so it is left in place.
    const onMeta = () => { if (Number.isFinite(audio.duration)) setDuration(audio.duration) }
    const onPlay = () => { setPlaying(true); setError(null) }
    const onError = () => setError(describeMediaError(audio.error, audio.src))
    const onPause = () => setPlaying(false)
    const onEnd = () => step(1, true)
    const onVolume = () => { setVol(audio.volume); setMuted(audio.muted) }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('durationchange', onMeta)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('error', onError)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnd)
    audio.addEventListener('volumechange', onVolume)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('durationchange', onMeta)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('error', onError)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnd)
      audio.removeEventListener('volumechange', onVolume)
    }
  }, [media, step])

  const play = useCallback((q: CollectionTrack[], i: number) => {
    const ord = shuffle ? shuffled(q.length, i) : inOrder(q.length)
    setQueue(q)
    setOrder(ord)
    start(ord.indexOf(i), q, ord)
  }, [shuffle, start])

  const toggle = useCallback(() => {
    const audio = media()
    if (!audio || posRef.current < 0) return
    if (audio.paused) {
      // The queue ran out on this track: play means play it again, not sit
      // silently at the end of it.
      if (audio.ended) audio.currentTime = 0
      audio.play().catch(() => {
        setPlaying(false)
        setError(describeMediaError(audio.error, audio.src))
      })
    } else audio.pause()
  }, [media])

  const next = useCallback(() => step(1, false), [step])

  /** Within the first few seconds "previous" means the previous track; after
   *  that it means the start of this one, the way every player behaves. */
  const prev = useCallback(() => {
    const audio = media()
    if (!audio) return
    if (audio.currentTime > 3) audio.currentTime = 0
    else step(-1, false)
  }, [media, step])

  const seek = useCallback((seconds: number) => {
    const audio = media()
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return
    audio.currentTime = Math.max(0, Math.min(seconds, audio.duration))
    setTime(audio.currentTime)
  }, [media])

  const stop = useCallback(() => {
    const audio = media()
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load() }
    setPos(-1)
    setQueue([])
    setOrder([])
    setTime(0)
    setDuration(0)
  }, [media])

  const setVolume = useCallback((v: number) => {
    const audio = media()
    const clamped = Math.max(0, Math.min(1, v))
    savePrefs({ volume: clamped, muted: clamped === 0 ? prefs().muted : false })
    setVol(clamped)
    if (!audio) return
    audio.volume = clamped
    // Nudging the slider is the plainest way of saying "unmute".
    if (clamped > 0 && audio.muted) { audio.muted = false; setMuted(false) }
  }, [media])

  const toggleMute = useCallback(() => {
    const audio = media()
    const v = !muted
    savePrefs({ muted: v })
    setMuted(v)
    if (audio) audio.muted = v
  }, [media, muted])

  /** Shuffling keeps the record that is playing on the deck: only what comes
   *  after it is reordered, so the toggle never interrupts anything. */
  const toggleShuffle = useCallback(() => {
    const on = !shuffle
    savePrefs({ shuffle: on })
    setShuffle(on)
    const places = orderRef.current
    const at = posRef.current
    if (!places.length || at < 0) return
    const track = places[at]
    const ord = on ? shuffled(queueRef.current.length, track) : inOrder(queueRef.current.length)
    orderRef.current = ord
    posRef.current = ord.indexOf(track)
    setOrder(ord)
    setPos(posRef.current)
  }, [shuffle])

  const cycleRepeat = useCallback(() => {
    const nextMode: RepeatMode = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off'
    savePrefs({ repeat: nextMode })
    repeatRef.current = nextMode
    setRepeat(nextMode)
  }, [repeat])

  const index = pos >= 0 ? order[pos] ?? -1 : -1

  return {
    queue, order, index, playing, time, duration, error, volume, muted, shuffle, repeat,
    current: index >= 0 ? queue[index] ?? null : null,
    progress: duration > 0 ? Math.min(1, time / duration) : 0,
    hasNext: pos >= 0 && (pos + 1 < order.length || repeat !== 'off'),
    play, toggle, next, prev, seek, stop,
    setVolume, toggleMute, toggleShuffle, cycleRepeat,
  }
}

/** Everything the keyboard can do to playback, so the shortcuts work from any
 *  screen rather than only from the collection. */
export function usePlayerKeys(player: PlayerState): void {
  // The player object is new on every tick of the clock; the handler reads it
  // through a ref so the listener is attached once and not sixty times a minute.
  const live = useRef(player)
  useEffect(() => { live.current = player })

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const player = live.current
      const el = document.activeElement as HTMLElement | null
      // Never steal a key from a text field, and leave the arrow keys to a
      // slider that has the focus - it uses them itself.
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' ||
        el.isContentEditable || el.getAttribute('role') === 'slider')) return
      if (e.ctrlKey || e.altKey || e.metaKey) return
      // Space belongs to whatever is focused if that thing can be pressed.
      if (e.key === ' ' && el && (el.tagName === 'BUTTON' || el.tagName === 'A' ||
        el.getAttribute('role') === 'switch')) return
      switch (e.key) {
        case ' ': e.preventDefault(); player.toggle(); break
        case 'ArrowRight': e.preventDefault(); player.seek(player.time + 5); break
        case 'ArrowLeft': e.preventDefault(); player.seek(player.time - 5); break
        case 'ArrowUp': e.preventDefault(); player.setVolume(player.volume + 0.05); break
        case 'ArrowDown': e.preventDefault(); player.setVolume(player.volume - 0.05); break
        case 'n': case 'N': player.next(); break
        case 'p': case 'P': player.prev(); break
        case 's': case 'S': player.toggleShuffle(); break
        case 'r': case 'R': player.cycleRepeat(); break
        case 'm': case 'M': player.toggleMute(); break
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
}
