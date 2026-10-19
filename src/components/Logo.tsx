/** The Tunefold mark: a record with one quadrant folded away. Same art as the app icon. */
export function Logo({ size = 64, plate = true }: { size?: number; plate?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" role="img" aria-label="Tunefold">
      {plate && <rect width="512" height="512" rx="116" fill="var(--color-panel)" />}
      <circle cx="256" cy="256" r="176" fill="#22262e" />
      <circle cx="256" cy="256" r="146" fill="none" stroke="#343944" strokeWidth="5" />
      <circle cx="256" cy="256" r="118" fill="none" stroke="#343944" strokeWidth="5" />
      <circle cx="256" cy="256" r="90" fill="none" stroke="#343944" strokeWidth="5" />
      <path d="M256 256 L256 80 A176 176 0 0 1 432 256 Z" fill={plate ? 'var(--color-panel)' : 'var(--color-bg)'} />
      <path d="M256 80 L432 80 L432 256 Z" fill="var(--color-accent)" stroke="var(--color-accent)" strokeWidth="10" strokeLinejoin="round" />
      <circle cx="256" cy="256" r="58" fill="var(--color-accent)" />
      <circle cx="256" cy="256" r="12" fill="var(--color-bg)" />
    </svg>
  )
}
