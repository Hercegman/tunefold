/** The three catalogues Tunefold can read, as the backend names them. */
export const SOURCES = {
  spotify: { label: 'Spotify', example: 'https://open.spotify.com/playlist/…' },
  deezer: { label: 'Deezer', example: 'https://www.deezer.com/album/…' },
  apple: { label: 'Apple Music', example: 'https://music.apple.com/us/playlist/…' },
} as const

export type SourceName = keyof typeof SOURCES

export const SOURCE_NAMES = Object.keys(SOURCES) as SourceName[]

export const sourceLabel = (s: string | undefined): string =>
  SOURCES[s as SourceName]?.label ?? 'Source'

/** Links worth picking up when something is pasted outside the input. */
export const LINK_RE =
  /open\.spotify\.com|spotify:[a-z]+:|deezer\.com|(?:deezer|dzr)\.page\.link|music\.apple\.com/i
