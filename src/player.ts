import { useCallback, useEffect, useRef, useState } from 'react'
import { audioUrl } from './api'
import type { CollectionTrack } from './types'

export interface PlayerState {
  queue: CollectionTrack[]
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
    audio.play().catch(() => setPlaying(false))
    setIndex(i)
    setTime(0)
    setDuration(0)
  }, [media])

  useEffect(() => {
    const audio = media()
    if (!audio) return
    const onTime = () => setTime(audio.currentTime)
    const onMeta = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    const onPlay = () => setPlaying(true)
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
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnd)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('durationchange', onMeta)
      audio.removeEventListener('play', onPlay)
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
    if (audio.paused) audio.play().catch(() => setPlaying(false))
    else audio.pause()
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
    queue, index, playing, time, duration,
    current: index >= 0 ? queue[index] ?? null : null,
    progress: duration > 0 ? Math.min(1, time / duration) : 0,
    play, toggle, next, prev, seek, stop,
  }
}
