import type { ChainEntry, MatchedOn, Track, Via } from '@/lib/rules'
import type { AppTrack } from '@/lib/spotify'

/**
 * The shape of a chain entry, and the pure conversions between it and what
 * the rules engine wants.
 *
 * Deliberately separate from `chain.ts`: the client renders and re-validates
 * entries, and importing them from the persistence module dragged `pg` --
 * and with it `fs` and `dns` -- into the browser bundle.
 */
export type StoredEntry = {
  id: string
  position: number
  track: AppTrack
  matchedWord: string | null
  matchedOn: MatchedOn | null
  via: Via | null
  seatId: string | null
  seatName: string | null
  isSeed: boolean
  wasOverride: boolean
  queuedToSpotify: boolean
  playedAt: string | null
  createdAt: string
}

/** The rules engine only ever sees the fields it declares. */
export function toRulesTrack(track: AppTrack): Track {
  return {
    id: track.id,
    title: track.title,
    artists: track.artists,
    durationMs: track.durationMs,
  }
}

export function toRulesHistory(entries: readonly StoredEntry[]): ChainEntry[] {
  return entries.map((entry) => ({
    track: toRulesTrack(entry.track),
    matchedWord: entry.matchedWord,
    matchedOn: entry.matchedOn,
    via: entry.via,
  }))
}
