export interface Track {
  id: string
  title: string
  artists: string[]
  credit: string
  duration_ms: number | null
  album: string | null
  release_date: string | null
  cover_url: string | null
  position: number | null
  playable: boolean
}

export interface Playlist {
  id: string
  kind: 'playlist' | 'album' | 'track'
  name: string
  owner: string | null
  cover_url: string | null
  total: number | null
  tracks: Track[]
}

export interface Suggestion {
  id: string
  kind: 'merge' | 'spelling' | 'feat' | 'alias'
  to: string
  sources: string[]
  track_ids: string[]
  count_to: number
  alternatives: string[]
  applied: boolean
  reason: string
}

export interface Preview {
  playlist: Playlist
  analysis: { artist_map: Record<string, string>; suggestions: Suggestion[] }
  have: Record<string, string>
}

export interface Settings {
  out_dir: string
  format: 'mp3' | 'm4a' | 'opus' | 'flac' | 'wav'
  quality: '128' | '192' | '256' | '320'
  naming: 'artist-title' | 'title-artist' | 'title'
  track_numbers: boolean
  folder_mode: 'playlist' | 'artist' | 'artist-album'
  parallel: number
  loose_match: boolean
  cookies: string
}

export type TrackStatus =
  | 'queued' | 'metadata' | 'searching' | 'downloading' | 'converting' | 'tagging' | 'done' | 'skipped' | 'failed' | 'cancelled'

export interface TrackState {
  id: string
  status: TrackStatus
  progress: number
  title?: string
  credit?: string
  artist?: string
  yt_title?: string
  yt_url?: string
  file?: string
  error?: string
}

export interface JobSnapshot {
  id: string
  status: 'running' | 'finished' | 'cancelled'
  total: number
  done: number
  failed: number
  folder: string | null
  tracks: TrackState[]
}

export interface Recent {
  url: string
  kind: string
  name: string
  owner: string | null
  cover_url: string | null
  total: number | null
  seen: number
}

export interface Alias { credit_key: string; credit: string; canonical: string; created: number }
