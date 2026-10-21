import { useEffect, useRef, useState } from 'react'

/** A whole deck, not a floating record: the platter sits where it sits on a
 *  real turntable - left of centre, with the arm at the back right - and the
 *  plinth around it is what the eye centres on. */
const DECK = { x: 16, y: 16, w: 628, h: 528, r: 20 }
const C = { x: 264, y: 252 }          // spindle
const R_PLATTER = 196
const R_MAT = 186                     // the felt, a touch inside the rim
const R_REC = 180
const PIVOT = { x: 545, y: 104 }
const ARM = 250
const R_OUT = R_REC * 0.95            // outer groove, where a side starts
const R_LABEL = R_REC * 0.46          // the paper label, where it runs out
const RPM = { 33: 33 + 1 / 3, 45: 45 } as const
type Speed = keyof typeof RPM

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
/** The grooves, plus the brighter rings that are the gaps between tracks -
 *  the thing you look for when you want to drop the needle on song three. */
const GROOVES = Array.from({ length: 22 }, (_, i) => R_LABEL + 6 + i * ((R_OUT - R_LABEL - 6) / 22))
const TRACK_GAPS = [0.22, 0.45, 0.66, 0.85].map((f) => R_LABEL + 6 + f * (R_OUT - R_LABEL - 6))
/** Ticks either side of the pitch fader's centre detent. */
const PITCH_TICKS = Array.from({ length: 9 }, (_, i) => 436 + i * 17)

/** Arcs for the label text, so a record with no artwork still says what it is. */
const labelArc = (r: number, from: number, to: number, sweep: 0 | 1) => {
  const pt = (a: number) => `${(C.x + r * Math.cos((a * Math.PI) / 180)).toFixed(2)} ${(C.y + r * Math.sin((a * Math.PI) / 180)).toFixed(2)}`
  return `M ${pt(from)} A ${r} ${r} 0 0 ${sweep} ${pt(to)}`
}
const ARC_TOP = labelArc(R_LABEL - 16, 203, 337, 1)
const ARC_BOTTOM = labelArc(R_LABEL - 14, 155, 25, 0)

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

const reducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function Turntable({ cover, progress, playing, swapping, trackKey, title, artist, onSeek, onToggle }: {
  cover: string | null
  progress: number
  playing: boolean
  /** True for the moment between records: the arm lifts, a new disc drops in. */
  swapping: boolean
  trackKey: string
  title?: string
  artist?: string
  onSeek: (progress: number) => void
  /** The cue lever and the start/stop button both do this. */
  onToggle?: () => void
}) {
  const svg = useRef<SVGSVGElement>(null)
  const disc = useRef<SVGGElement>(null)
  const platter = useRef<SVGGElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const [speed, setSpeed] = useState<Speed>(33)
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
    let speedNow = 0
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      const target = playing && !swapping ? RPM[speed] * 6 : 0   // rpm -> deg/s
      speedNow += (target - speedNow) * Math.min(1, dt * 3.5)
      angle = (angle + speedNow * dt) % 360
      const turn = `rotate(${angle}deg)`
      if (disc.current) disc.current.style.transform = turn
      if (platter.current) platter.current.style.transform = turn
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, swapping, trackKey, speed])

  const shown = drag ?? progress
  const loaded = Boolean(trackKey)
  const parked = swapping || !loaded
  const armAngle = parked ? A_REST : A_START + shown * (A_END - A_START)
  /** A stopped record means a lifted stylus, the way you would leave it. */
  const lifted = parked || (!playing && drag === null)
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
        <path id="tf-arc-top" d={ARC_TOP} />
        <path id="tf-arc-bottom" d={ARC_BOTTOM} />
        <radialGradient id="tf-vinyl" cx="50%" cy="50%">
          <stop offset="40%" stopColor="#15171c" />
          <stop offset="85%" stopColor="#0c0d10" />
          <stop offset="100%" stopColor="#1a1d23" />
        </radialGradient>
        <linearGradient id="tf-sheen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.08" />
          <stop offset="42%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="58%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.06" />
        </linearGradient>
        <linearGradient id="tf-deck" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1d2027" />
          <stop offset="100%" stopColor="#141720" />
        </linearGradient>
        <linearGradient id="tf-metal" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#5c6271" />
          <stop offset="35%" stopColor="#aeb4c2" />
          <stop offset="70%" stopColor="#7d8491" />
          <stop offset="100%" stopColor="#5c6271" />
        </linearGradient>
        <linearGradient id="tf-tube" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#5f6573" />
          <stop offset="40%" stopColor="#b9bfcc" />
          <stop offset="100%" stopColor="#6a7180" />
        </linearGradient>
        <radialGradient id="tf-mat" cx="50%" cy="50%">
          <stop offset="70%" stopColor="#23272f" />
          <stop offset="100%" stopColor="#191c23" />
        </radialGradient>
        <radialGradient id="tf-glow" cx="50%" cy="50%">
          <stop offset="0%" stopColor="#1ed760" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#1ed760" stopOpacity="0" />
        </radialGradient>
        <filter id="tf-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="6" stdDeviation="7" floodColor="#000000" floodOpacity="0.55" />
        </filter>
      </defs>

      {/* plinth */}
      <rect x={DECK.x} y={DECK.y} width={DECK.w} height={DECK.h} rx={DECK.r}
        fill="url(#tf-deck)" stroke="#2a2e37" strokeWidth="1.5" />
      <rect x={DECK.x + 8} y={DECK.y + 8} width={DECK.w - 16} height={DECK.h - 16} rx={DECK.r - 6}
        fill="none" stroke="#ffffff" strokeOpacity="0.03" />
      {/* the four feet, and the hinges the dust cover would sit on */}
      {[[DECK.x + 30, DECK.y + DECK.h - 8], [DECK.x + DECK.w - 30, DECK.y + DECK.h - 8]].map(([x, y]) => (
        <ellipse key={`foot${x}`} cx={x} cy={y} rx="16" ry="5" fill="#0a0b0e" fillOpacity="0.8" />
      ))}
      {[200, 470].map((x) => (
        <rect key={`hinge${x}`} x={x} y={DECK.y - 4} width="46" height="14" rx="4" fill="#22262e" stroke="#343944" />
      ))}

      {/* platter well, with the shadow the platter casts into it */}
      <circle cx={C.x} cy={C.y} r={R_PLATTER + 13} fill="#0d0f13" />
      <circle cx={C.x} cy={C.y} r={R_PLATTER + 13} fill="none" stroke="#000000" strokeOpacity="0.5" />

      {/* platter: strobe dots round the rim, the way a deck shows its speed */}
      <g ref={platter} style={spin}>
        <circle cx={C.x} cy={C.y} r={R_PLATTER} fill="#191c23" />
        {STROBE.map((a) => (
          <circle key={a} r="2" fill="#8b91a0" fillOpacity="0.45"
            cx={C.x + (R_PLATTER - 7) * Math.cos(a)} cy={C.y + (R_PLATTER - 7) * Math.sin(a)} />
        ))}
        {/* the felt mat, with the rings pressed into it */}
        <circle cx={C.x} cy={C.y} r={R_MAT} fill="url(#tf-mat)" />
        {[R_MAT - 10, R_MAT - 26, R_MAT - 44].map((r) => (
          <circle key={r} cx={C.x} cy={C.y} r={r} fill="none" stroke="#ffffff" strokeOpacity="0.035" />
        ))}
      </g>

      {/* no record on the platter until there is something to play */}
      {loaded && (
      <g key={trackKey} ref={disc} className="tf-disc" style={spin} filter="url(#tf-shadow)">
        <circle cx={C.x} cy={C.y} r={R_REC} fill="url(#tf-vinyl)" />
        {GROOVES.map((r) => (
          <circle key={r} cx={C.x} cy={C.y} r={r} fill="none" stroke="#ffffff" strokeOpacity={0.06} strokeWidth="1" />
        ))}
        {TRACK_GAPS.map((r) => (
          <circle key={`gap${r}`} cx={C.x} cy={C.y} r={r} fill="none" stroke="#ffffff" strokeOpacity={0.16} strokeWidth="1.4" />
        ))}
        <circle cx={C.x} cy={C.y} r={R_LABEL} fill={showArt ? '#0b0d10' : '#1ed760'} />
        {showArt && (
          <image href={cover!} clipPath="url(#tf-label)" preserveAspectRatio="xMidYMid slice"
            x={C.x - R_LABEL} y={C.y - R_LABEL} width={R_LABEL * 2} height={R_LABEL * 2}
            onError={() => setNoArt(trackKey)} />
        )}
        {!showArt && (
          // A pressing with no sleeve still has its name printed round the hole.
          <g fill="#06250f" fontFamily="inherit" fontWeight="600">
            <circle cx={C.x} cy={C.y} r={R_LABEL - 8} fill="none" stroke="#06250f" strokeOpacity="0.25" />
            <text fontSize="11" letterSpacing="1.2">
              <textPath href="#tf-arc-top" startOffset="50%" textAnchor="middle">{clip(artist || 'Tunefold', 26)}</textPath>
            </text>
            <text fontSize="8.5" letterSpacing="2.4" fillOpacity="0.72">
              <textPath href="#tf-arc-bottom" startOffset="50%" textAnchor="middle">{`${speed === 33 ? '33⅓' : '45'} RPM · STEREO`}</textPath>
            </text>
            <text x={C.x} y={C.y + 26} textAnchor="middle" fontSize="10" fontWeight="500" fillOpacity="0.85">
              {clip(title || '', 18)}
            </text>
          </g>
        )}
        <circle cx={C.x} cy={C.y} r={R_LABEL} fill="none" stroke="#000000" strokeOpacity="0.45" strokeWidth="2" />
        <circle cx={C.x} cy={C.y} r="6" fill="#0e0f12" />
      </g>
      )}
      {/* the sheen is a reflection of the room, so it stays put while the
          record turns underneath it */}
      {loaded && <circle cx={C.x} cy={C.y} r={R_REC} fill="url(#tf-sheen)" pointerEvents="none" />}
      {/* spindle, and the 45 adapter parked on its post beside the platter */}
      <circle cx={C.x} cy={C.y} r="6" fill="#0e0f12" />
      <circle cx={C.x} cy={C.y} r="2.5" fill="#6c7383" />
      <g transform="translate(64,76)">
        <circle r="13" fill="#1a1d23" stroke="#2a2e37" />
        <circle r="9" fill="none" stroke="#6c7383" strokeOpacity="0.55" strokeWidth="3" />
        <circle r="3" fill="#0e0f12" />
      </g>

      {/* arm rest, where the arm parks between sides */}
      <ellipse cx={REST.x} cy={REST.y + 20} rx="17" ry="8" fill="#1a1d23" stroke="#2a2e37" />
      <rect x={REST.x - 5} y={REST.y - 6} width="10" height="26" rx="4" fill="#22262e" stroke="#343944" />
      <rect x={REST.x - 11} y={REST.y - 12} width="22" height="12" rx="5" fill="#2a2e37" stroke="#434a58" />

      {/* start / stop, the speed buttons and the pitch fader */}
      <g>
        <rect x={52} y={466} width={66} height={48} rx="9" fill="#22262e" stroke="#343944" />
        <circle cx={85} cy={490} r="15" fill={playing ? '#1b3a26' : '#1a1d23'} stroke={playing ? '#1ed760' : '#434a58'}
          strokeOpacity={playing ? 0.8 : 1}
          style={{ cursor: onToggle ? 'pointer' : 'default' }} onClick={() => onToggle?.()} />
        <circle cx={85} cy={490} r="6" fill={playing ? '#1ed760' : '#343944'} pointerEvents="none" />
        {playing && <circle cx={85} cy={490} r="22" fill="url(#tf-glow)" pointerEvents="none" />}
        <text x={85} y={510} fill="#8b91a0" fillOpacity="0.6" fontSize="7" letterSpacing="1"
          textAnchor="middle" fontFamily="inherit" pointerEvents="none">START/STOP</text>

        {([33, 45] as Speed[]).map((s, i) => (
          <g key={s} style={{ cursor: 'pointer' }} onClick={() => setSpeed(s)}>
            <rect x={132} y={466 + i * 26} width={36} height={22} rx="5"
              fill={speed === s ? '#1b3a26' : '#22262e'} stroke={speed === s ? '#1ed760' : '#343944'} />
            <circle cx={139} cy={477 + i * 26} r="2" fill={speed === s ? '#1ed760' : '#434a58'} />
            <text x={153} y={481 + i * 26} fill={speed === s ? '#1ed760' : '#8b91a0'} fontSize="9"
              textAnchor="middle" fontFamily="inherit">{s}</text>
          </g>
        ))}

        {PITCH_TICKS.map((x, i) => (
          <line key={x} x1={x} y1={i === 4 ? 468 : 472} x2={x} y2={478}
            stroke={i === 4 ? '#8b91a0' : '#6c7383'} strokeOpacity={i === 4 ? 0.8 : 0.35} />
        ))}
        <text x={436} y={466} fill="#8b91a0" fillOpacity="0.45" fontSize="7" fontFamily="inherit">-8</text>
        <text x={566} y={466} fill="#8b91a0" fillOpacity="0.45" fontSize="7" textAnchor="end" fontFamily="inherit">+8</text>
        <rect x={430} y={484} width={150} height={12} rx="6" fill="#16181d" stroke="#2a2e37" />
        <rect x={498} y={478} width="14" height="24" rx="4" fill="url(#tf-metal)" stroke="#343944" />
        <line x1={505} y1={482} x2={505} y2={498} stroke="#0e0f12" strokeOpacity="0.6" />
        <text x={505} y={512} fill="#8b91a0" fillOpacity="0.6" fontSize="7" letterSpacing="1"
          textAnchor="middle" fontFamily="inherit">PITCH</text>

        <text x={DECK.x + DECK.w - 26} y={DECK.y + 34} fill="#8b91a0" fillOpacity="0.5" fontSize="11"
          letterSpacing="3" textAnchor="end" fontFamily="inherit">TUNEFOLD</text>
        <text x={DECK.x + 28} y={DECK.y + 34} fill="#8b91a0" fillOpacity="0.3" fontSize="8"
          letterSpacing="2" fontFamily="inherit">TF-1 · DIRECT DRIVE</text>
      </g>

      {/* the arm's furniture: anti-skate dial, and the cue lever that lifts it */}
      <g>
        <circle cx={592} cy={150} r="13" fill="#22262e" stroke="#434a58" />
        <circle cx={592} cy={150} r="4" fill="#6c7383" />
        <line x1={592} y1={150} x2={592} y2={140} stroke="#aeb4c2" strokeWidth="1.5" />
        <text x={592} y={174} fill="#8b91a0" fillOpacity="0.5" fontSize="7" letterSpacing="1"
          textAnchor="middle" fontFamily="inherit">ANTI-SKATE</text>

        <g style={{ cursor: onToggle ? 'pointer' : 'default' }} onClick={() => onToggle?.()}>
          <rect x={596} y={208} width={14} height={34} rx="6" fill="#1a1d23" stroke="#2a2e37" />
          <rect x={593} y={lifted ? 210 : 226} width={20} height="14" rx="6" fill="url(#tf-metal)" stroke="#343944"
            style={{ transition: 'y 220ms cubic-bezier(.4,0,.2,1)' }} />
          <text x={603} y={256} fill="#8b91a0" fillOpacity="0.5" fontSize="7" letterSpacing="1"
            textAnchor="middle" fontFamily="inherit">CUE</text>
        </g>
      </g>

      {/* tonearm: the progress bar, and the way to scrub */}
      <g className="tf-arm" style={{
        transform: `rotate(${deg(armAngle)}deg)`,
        transformOrigin: `${PIVOT.x}px ${PIVOT.y}px`,
        transition: drag !== null ? 'none'
          : swapping ? 'transform 600ms cubic-bezier(.4,0,.2,1)'
          : 'transform 260ms linear',
      }}>
        {/* counterweight, on its stub behind the pivot */}
        <rect x={PIVOT.x - 3} y={PIVOT.y - 30} width="6" height="24" fill="#6c7383" />
        <rect x={PIVOT.x - 12} y={PIVOT.y - 56} width="24" height="30" rx="9" fill="url(#tf-metal)" stroke="#343944" />
        {[-50, -44, -38].map((dy) => (
          <line key={dy} x1={PIVOT.x - 11} y1={PIVOT.y + dy} x2={PIVOT.x + 11} y2={PIVOT.y + dy}
            stroke="#0e0f12" strokeOpacity="0.35" />
        ))}

        {/* the tube, tapering towards the headshell */}
        <path d={`M ${PIVOT.x - 4.5} ${PIVOT.y} L ${PIVOT.x + 4.5} ${PIVOT.y}
          L ${PIVOT.x + 3.5} ${PIVOT.y + ARM - 34} L ${PIVOT.x - 3.5} ${PIVOT.y + ARM - 34} Z`}
          fill="url(#tf-tube)" />
        {/* the lift: a stopped stylus sits a hair above the record */}
        <g style={{
          transform: lifted ? 'translateY(-7px)' : 'none',
          transition: 'transform 240ms cubic-bezier(.4,0,.2,1)',
        }}>
          {/* finger lift */}
          <path d={`M ${PIVOT.x - 13} ${PIVOT.y + ARM - 30} l -11 -5 l 2 5 z`} fill="#8b91a0" />
          {/* headshell and the cartridge in it */}
          <path d={`M ${PIVOT.x - 13} ${PIVOT.y + ARM - 34} h 26 l -2 22 h -22 z`} fill="#c3c8d4" />
          <rect x={PIVOT.x - 9} y={PIVOT.y + ARM - 16} width="18" height="12" rx="2" fill="#2a2e37" />
          <rect x={PIVOT.x - 6} y={PIVOT.y + ARM - 30} width="12" height="5" rx="1" fill="#8b91a0" />
          {/* cantilever and the stylus itself */}
          <line x1={PIVOT.x} y1={PIVOT.y + ARM - 6} x2={PIVOT.x} y2={PIVOT.y + ARM - 1}
            stroke="#e8eaf0" strokeWidth="1.5" />
          <circle cx={PIVOT.x} cy={PIVOT.y + ARM} r="2.5" fill={playing && !parked ? '#1ed760' : '#6c7383'} />
        </g>
        {/* the whole length of the arm is the grab handle for scrubbing */}
        <line x1={PIVOT.x} y1={PIVOT.y + 6} x2={PIVOT.x} y2={PIVOT.y + ARM - 22}
          stroke="transparent" strokeWidth="42" style={{ cursor: 'grab', pointerEvents: 'stroke' }}
          onPointerDown={(e) => {
            if (!loaded) return
            e.currentTarget.setPointerCapture(e.pointerId)
            setDrag(progress)
          }} />
      </g>
      {/* pivot housing, and the little target light that leans over it */}
      <circle cx={PIVOT.x} cy={PIVOT.y} r="19" fill="#22262e" stroke="#434a58" />
      <circle cx={PIVOT.x} cy={PIVOT.y} r="12" fill="#2a2e37" stroke="#343944" />
      <circle cx={PIVOT.x} cy={PIVOT.y} r="5" fill="#0e0f12" />
      <g>
        <line x1={PIVOT.x + 22} y1={PIVOT.y - 12} x2={PIVOT.x + 44} y2={PIVOT.y - 34} stroke="#434a58" strokeWidth="3" />
        <circle cx={PIVOT.x + 46} cy={PIVOT.y - 36} r="5" fill={playing ? '#f5b84c' : '#22262e'} stroke="#434a58" />
        {playing && <circle cx={PIVOT.x + 46} cy={PIVOT.y - 36} r="11" fill="#f5b84c" fillOpacity="0.18" />}
      </g>
    </svg>
  )
}
