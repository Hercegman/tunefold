import { useEffect, useRef, useState } from 'react'

/** A whole deck, not a floating record: the platter sits where it sits on a
 *  real turntable - left of centre, with the arm at the back right - and the
 *  plinth around it is what the eye centres on. */
const DECK = { x: 16, y: 16, w: 628, h: 528, r: 20 }
const C = { x: 264, y: 252 }          // spindle
const R_PLATTER = 196
const R_REC = 180
const PIVOT = { x: 545, y: 104 }
const ARM = 250
const R_OUT = R_REC * 0.95            // outer groove, where a side starts
const R_LABEL = R_REC * 0.46          // the paper label, where it runs out
const RPM = 33 + 1 / 3
const SPIN_MS = (60 / RPM) * 1000     // 1800 ms a revolution, the real figure

/** Where the stylus sits for a given arm angle. SVG rotates the other way
 *  round from the usual maths convention once y points down, hence the minus:
 *  a positive angle swings the arm left, in over the record. */
const stylusAt = (t: number) => ({
  x: PIVOT.x - ARM * Math.sin(t),
  y: PIVOT.y + ARM * Math.cos(t),
})

const radiusAt = (t: number) => {
  const s = stylusAt(t)
  return Math.hypot(s.x - C.x, s.y - C.y)
}

function angleFor(target: number): number {
  let lo = -0.3, hi = 1.2             // radius shrinks as the arm swings in
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (radiusAt(mid) > target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

const A_START = angleFor(R_OUT)
const A_END = angleFor(R_LABEL)
const A_REST = -0.08                  // parked in the cradle
const REST = stylusAt(A_REST)
const deg = (rad: number) => (rad * 180) / Math.PI

const STROBE = Array.from({ length: 48 }, (_, i) => (i * 2 * Math.PI) / 48)
const GROOVES = Array.from({ length: 16 }, (_, i) => R_LABEL + 8 + i * ((R_OUT - R_LABEL - 8) / 16))

const reducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function Turntable({ cover, progress, playing, swapping, trackKey, onSeek }: {
  cover: string | null
  progress: number
  playing: boolean
  /** True for the moment between records: the arm lifts, a new disc drops in. */
  swapping: boolean
  trackKey: string
  onSeek: (progress: number) => void
}) {
  const svg = useRef<SVGSVGElement>(null)
  const disc = useRef<SVGGElement>(null)
  const platter = useRef<SVGGElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  // A cover that will not load leaves a broken-image glyph in the middle of
  // the record; the plain green label is the better fallback.
  const [noArt, setNoArt] = useState<string | null>(null)
  const showArt = Boolean(cover) && noArt !== trackKey

  // Rotation is driven frame by frame rather than by a CSS animation, so the
  // platter can spin up and coast down instead of snapping between states -
  // and requestAnimationFrame stops on its own when the window is hidden.
  useEffect(() => {
    if (reducedMotion()) return
    let raf = 0
    let last = performance.now()
    let angle = 0
    let speed = 0
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      const target = playing && !swapping ? 360 / (SPIN_MS / 1000) : 0
      speed += (target - speed) * Math.min(1, dt * 3.5)
      angle = (angle + speed * dt) % 360
      const turn = `rotate(${angle}deg)`
      if (disc.current) disc.current.style.transform = turn
      if (platter.current) platter.current.style.transform = turn
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, swapping, trackKey])

  const shown = drag ?? progress
  const armAngle = swapping || !trackKey ? A_REST : A_START + shown * (A_END - A_START)
  const spin = { transformOrigin: `${C.x}px ${C.y}px` }

  const toProgress = (e: React.PointerEvent): number | null => {
    const node = svg.current
    const ctm = node?.getScreenCTM()
    if (!node || !ctm) return null
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    const t = Math.atan2(PIVOT.x - p.x, p.y - PIVOT.y)
    return Math.max(0, Math.min(1, (t - A_START) / (A_END - A_START)))
  }

  return (
    <svg ref={svg} viewBox="0 0 660 560" className="h-full w-full select-none"
      onPointerMove={(e) => { if (drag !== null) { const p = toProgress(e); if (p !== null) setDrag(p) } }}
      onPointerUp={() => { if (drag !== null) { onSeek(drag); setDrag(null) } }}
      onPointerLeave={() => { if (drag !== null) { onSeek(drag); setDrag(null) } }}>
      <defs>
        <clipPath id="tf-label"><circle cx={C.x} cy={C.y} r={R_LABEL - 1} /></clipPath>
        <radialGradient id="tf-vinyl" cx="50%" cy="50%">
          <stop offset="40%" stopColor="#15171c" />
          <stop offset="85%" stopColor="#0c0d10" />
          <stop offset="100%" stopColor="#1a1d23" />
        </radialGradient>
        <linearGradient id="tf-sheen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.07" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.05" />
        </linearGradient>
        <linearGradient id="tf-deck" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1d2027" />
          <stop offset="100%" stopColor="#141720" />
        </linearGradient>
      </defs>

      {/* plinth */}
      <rect x={DECK.x} y={DECK.y} width={DECK.w} height={DECK.h} rx={DECK.r}
        fill="url(#tf-deck)" stroke="#2a2e37" strokeWidth="1.5" />
      <rect x={DECK.x + 8} y={DECK.y + 8} width={DECK.w - 16} height={DECK.h - 16} rx={DECK.r - 6}
        fill="none" stroke="#ffffff" strokeOpacity="0.03" />

      {/* platter well */}
      <circle cx={C.x} cy={C.y} r={R_PLATTER + 12} fill="#0d0f13" />
      <circle cx={C.x} cy={C.y} r={R_PLATTER + 12} fill="none" stroke="#000000" strokeOpacity="0.5" />

      {/* platter: strobe dots round the rim, the way a deck shows its speed */}
      <g ref={platter} style={spin}>
        <circle cx={C.x} cy={C.y} r={R_PLATTER} fill="#191c23" />
        {STROBE.map((a) => (
          <circle key={a} r="2" fill="#8b91a0" fillOpacity="0.45"
            cx={C.x + (R_PLATTER - 7) * Math.cos(a)} cy={C.y + (R_PLATTER - 7) * Math.sin(a)} />
        ))}
        <circle cx={C.x} cy={C.y} r={R_PLATTER - 16} fill="#13161c" />
      </g>

      {/* no record on the platter until there is something to play */}
      {trackKey && (
      <g key={trackKey} ref={disc} className="tf-disc" style={spin}>
        <circle cx={C.x} cy={C.y} r={R_REC} fill="url(#tf-vinyl)" />
        {GROOVES.map((r) => (
          <circle key={r} cx={C.x} cy={C.y} r={r} fill="none" stroke="#ffffff" strokeOpacity={0.07} strokeWidth="1" />
        ))}
        <circle cx={C.x} cy={C.y} r={R_REC} fill="url(#tf-sheen)" />
        <circle cx={C.x} cy={C.y} r={R_LABEL} fill={showArt ? '#0b0d10' : '#1ed760'} />
        {showArt && (
          <image href={cover!} clipPath="url(#tf-label)" preserveAspectRatio="xMidYMid slice"
            x={C.x - R_LABEL} y={C.y - R_LABEL} width={R_LABEL * 2} height={R_LABEL * 2}
            onError={() => setNoArt(trackKey)} />
        )}
        <circle cx={C.x} cy={C.y} r={R_LABEL} fill="none" stroke="#000000" strokeOpacity="0.45" strokeWidth="2" />
        <circle cx={C.x} cy={C.y} r="6" fill="#0e0f12" />
      </g>
      )}
      <circle cx={C.x} cy={C.y} r="6" fill="#0e0f12" />

      {/* arm rest, where the arm parks between sides */}
      <ellipse cx={REST.x} cy={REST.y + 20} rx="17" ry="8" fill="#1a1d23" stroke="#2a2e37" />
      <rect x={REST.x - 5} y={REST.y - 6} width="10" height="26" rx="4" fill="#22262e" stroke="#343944" />
      <rect x={REST.x - 11} y={REST.y - 12} width="22" height="12" rx="5" fill="#2a2e37" stroke="#434a58" />

      {/* deck furniture */}
      <g fill="#22262e" stroke="#343944">
        <rect x={56} y={470} width={64} height={44} rx="8" />
        <rect x={132} y={470} width={30} height={20} rx="5" />
        <rect x={132} y={494} width={30} height={20} rx="5" />
        <rect x={430} y={486} width={150} height={12} rx="6" />
      </g>
      <circle cx={88} cy={492} r="6" fill={playing ? '#1ed760' : '#343944'} />
      <rect x={498} y={480} width="14" height="24" rx="4" fill="#6c7383" />
      <line x1={505} y1={476} x2={505} y2={470} stroke="#8b91a0" strokeOpacity="0.5" />
      <text x={147} y={484} fill="#8b91a0" fontSize="9" textAnchor="middle" fontFamily="inherit">33</text>
      <text x={147} y={508} fill="#8b91a0" fontSize="9" textAnchor="middle" fontFamily="inherit">45</text>
      <text x={DECK.x + DECK.w - 26} y={DECK.y + 34} fill="#8b91a0" fillOpacity="0.5" fontSize="11"
        letterSpacing="3" textAnchor="end" fontFamily="inherit">TUNEFOLD</text>

      {/* tonearm: the progress bar, and the way to scrub */}
      <g className="tf-arm" style={{
        transform: `rotate(${deg(armAngle)}deg)`,
        transformOrigin: `${PIVOT.x}px ${PIVOT.y}px`,
        transition: drag !== null ? 'none'
          : swapping ? 'transform 600ms cubic-bezier(.4,0,.2,1)'
          : 'transform 260ms linear',
      }}>
        <line x1={PIVOT.x} y1={PIVOT.y} x2={PIVOT.x} y2={PIVOT.y + ARM - 22}
          stroke="#8b91a0" strokeWidth="7" strokeLinecap="round" />
        <rect x={PIVOT.x - 13} y={PIVOT.y + ARM - 30} width="26" height="30" rx="5" fill="#c3c8d4" />
        <circle cx={PIVOT.x} cy={PIVOT.y + ARM - 2} r="3.5" fill="#1ed760" />
        <rect x={PIVOT.x - 11} y={PIVOT.y - 52} width="22" height="34" rx="8" fill="#6c7383" />
        <line x1={PIVOT.x} y1={PIVOT.y + 6} x2={PIVOT.x} y2={PIVOT.y + ARM - 22}
          stroke="transparent" strokeWidth="42" style={{ cursor: 'grab', pointerEvents: 'stroke' }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDrag(progress) }} />
      </g>
      <circle cx={PIVOT.x} cy={PIVOT.y} r="17" fill="#2a2e37" stroke="#434a58" />
      <circle cx={PIVOT.x} cy={PIVOT.y} r="5" fill="#0e0f12" />
    </svg>
  )
}
