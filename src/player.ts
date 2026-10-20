import { useCallback, useEffect, useRef, useState } from 'react'
import { audioUrl } from './api'
import type { CollectionTrack } from './types'

export interface PlayerState {
  queue: CollectionTrack[]
  error: string | null
  current: CollectionTrack | null
  index: number
  playing: boolean
  time: number
  duration: number
  progress: number
  play: (queue: CollectionTrack[], index: number) => void
  toggle: () => void
  next: () => void
  prev: () => void
  seek: (seconds: number) => void
  stop: () => void
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

/** One <audio> element for the whole app, living outside the view tree so
 *  leaving the collection screen does not stop the music. */
export function usePlayer(): PlayerState {
  const el = useRef<HTMLAudioElement | null>(null)
  /** Built on first use - never during render - and kept for the session. */
  const media = useCallback(() => {
    if (typeof Audio === 'undefined') return null
    return (el.current ??= new Audio())
  }, [])

  const [queue, setQueue] = useState<CollectionTrack[]>([])
  const [index, setIndex] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Media events fire long after render, so the handlers read the queue
  // through refs instead of closing over a stale copy of it.
  const queueRef = useRef(queue)
  const indexRef = useRef(index)
  useEffect(() => { queueRef.current = queue }, [queue])
  useEffect(() => { indexRef.current = index }, [index])

  /** `list` is passed in when the queue has only just been handed over and
   *  React has not committed it yet. */
  const start = useCallback((i: number, list?: CollectionTrack[]) => {
    const audio = media()
    const tracks = list ?? queueRef.current
    const track = tracks[i]
    if (!audio || !track) return
    queueRef.current = tracks
    indexRef.current = i
    audio.src = audioUrl(track.file)
    audio.play().catch((e: unknown) => {
      setPlaying(false)
      // A rejected play() with no media error of its own is the autoplay
      // policy; anything else is the file or the decoder.
      setError(audio.error ? describeMediaError(audio.error, track.file)
        : `Could not start playback: ${e instanceof Error ? e.message : String(e)}`)
    })
    setIndex(i)
    setTime(0)
    setDuration(0)
    setError(null)
  }, [media])

  useEffect(() => {
    const audio = media()
    if (!audio) return
    const onTime = () => setTime(audio.currentTime)
    const onMeta = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    const onPlay = () => { setPlaying(true); setError(null) }
    const onError = () => setError(describeMediaError(audio.error, audio.src))
    const onPause = () => setPlaying(false)
    const onEnd = () => {
      const i = indexRef.current + 1
      if (i < queueRef.current.length) start(i)
      else { setPlaying(false); setIndex(-1) }
    }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('durationchange', onMeta)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('error', onError)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnd)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('durationchange', onMeta)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('error', onError)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnd)
    }
  }, [media, start])

  const play = useCallback((q: CollectionTrack[], i: number) => {
    setQueue(q)
    start(i, q)
  }, [start])

  const toggle = useCallback(() => {
    const audio = media()
    if (!audio || indexRef.current < 0) return
    if (audio.paused) {
      audio.play().catch(() => {
        setPlaying(false)
        setError(describeMediaError(audio.error, audio.src))
      })
    } else audio.pause()
  }, [media])

  const next = useCallback(() => {
    if (indexRef.current + 1 < queueRef.current.length) start(indexRef.current + 1)
  }, [start])

  /** Within the first few seconds "previous" means the previous track; after
   *  that it means the start of this one, the way every player behaves. */
  const prev = useCallback(() => {
    const audio = media()
    if (!audio) return
    if (audio.currentTime > 3 || indexRef.current <= 0) audio.currentTime = 0
    else start(indexRef.current - 1)
  }, [media, start])

  const seek = useCallback((seconds: number) => {
    const audio = media()
    if (!audio || !Number.isFinite(audio.duration)) return
    audio.currentTime = Math.max(0, Math.min(seconds, audio.duration))
    setTime(audio.currentTime)
  }, [media])

  const stop = useCallback(() => {
    media()?.pause()
    setIndex(-1)
    setQueue([])
  }, [media])

  return {
    queue, index, playing, time, duration, error,
    current: index >= 0 ? queue[index] ?? null : null,
    progress: duration > 0 ? Math.min(1, time / duration) : 0,
    play, toggle, next, prev, seek, stop,
  }
}
