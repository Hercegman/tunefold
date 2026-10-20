import type { SourceName } from './sources'

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
  source: SourceName
}

export interface Playlist {
  id: string
  source: SourceName
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

/** One YouTube upload the search turned up for a track. */
export interface YtCandidate {
  id: string
  url: string
  title: string
  duration: number | null        // seconds
  views: number | null
  channel: string | null
  verified: boolean
  tags: string[]                 // live, remix, altered, cover, lyrics, full
  off: number | null             // seconds away from the source duration
  eligible: boolean              // false: the automatic pick would refuse it
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
  chosen?: string                // id of the upload this track was taken from
  alternatives?: YtCandidate[]
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
  source: SourceName
  kind: string
  name: string
  owner: string | null
  cover_url: string | null
  total: number | null
  seen: number
}

export interface Stats {
  tracks: number
  artists: number
  playlists: number
  aliases: number
  last: number | null
}

/** One file in the local collection, filed under the folded artist name. */
export interface CollectionTrack {
  track_id: string
  source: SourceName
  title: string
  artist: string
  credit: string
  album: string | null
  file: string
  created: number
}

export interface Alias { credit_key: string; credit: string; canonical: string; created: number }
