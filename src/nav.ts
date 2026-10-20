import { useCallback, useEffect, useState } from 'react'

/** A view stack whose "back" works the way each desktop expects it to.
 *
 *  A single-page app that never touches history.pushState has an empty history,
 *  and the webview swallows every back gesture built on it: on Windows that is
 *  Alt+Left and the mouse's fourth button, on macOS the two-finger swipe. So
 *  each view pushes one history entry, popstate is the only place that pops the
 *  stack, and the in-app Back buttons (and Escape) just call history.back() -
 *  one code path, no matter which way the user asked to go back.
 */
export function useNav<V>(root: V) {
  const [stack, setStack] = useState<V[]>([root])

  useEffect(() => {
    const onPop = () => setStack((s) => {
      if (s.length > 1) return s.slice(0, -1)
      // Already at the root: put the entry back so a stray back gesture can
      // never navigate the webview off the app.
      history.pushState({ tf: true }, '')
      return s
    })
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  /** One level deeper, with a matching history entry. */
  const go = useCallback((v: V) => {
    history.pushState({ tf: true }, '')
    setStack((s) => [...s, v])
  }, [])

  /** Swap the current view without adding a level (retrying a download). */
  const replace = useCallback((v: V) => setStack((s) => [...s.slice(0, -1), v]), [])

  const back = useCallback(() => history.back(), [])

  return { view: stack[stack.length - 1], depth: stack.length, go, replace, back }
}
