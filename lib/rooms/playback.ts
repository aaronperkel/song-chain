import { query, transaction } from '@/lib/db'
import type { HostPlayback, HostQueue } from '@/lib/spotify'
import { runway, type StoredEntry } from './chain'
import type { Runway } from '@/lib/realtime/events'

/**
 * Turning what Spotify is playing into how much runway is left.
 *
 * The server is authoritative here for the same reason it is authoritative
 * about turns: every phone in the car shows the runway, and they must all show
 * the same number. So the host's device reports what Spotify says, and the
 * server decides what that means and tells everyone.
 *
 * The rule is deliberately conservative. An entry is marked played only when
 * playback has demonstrably moved *past* it. Marking a song played that has
 * not played yet makes the runway lie about a car journey's worth of music;
 * being a little late to mark one costs nothing but a stale number for ten
 * seconds.
 */

/** The minimum an entry needs for the decision. Keeps the logic testable. */
export type PlaybackEntry = {
  id: string
  trackId: string
  playedAt: string | null
}

export type PlaybackReading = {
  /** What Spotify reports as currently playing. Null when idle. */
  nowPlayingTrackId: string | null
  /**
   * Track ids Spotify still has queued, when the reconcile poll fetched them.
   * Null on the cheap polls that only read currently-playing.
   */
  queuedTrackIds: string[] | null
}

export type PlaybackResolution = {
  /** Entries that have now been played, in chain order. */
  playedEntryIds: string[]
  /** The chain entry currently playing, if it is one of ours. */
  nowPlayingEntryId: string | null
}

/**
 * Decide what playback has moved past.
 *
 * Two ways to locate our position in the chain, in order of confidence:
 *
 * 1. The currently-playing track is one of ours. Everything unplayed before it
 *    has been played. This is the ordinary case.
 * 2. It is not -- the host put on an unrelated album, or Spotify relinked the
 *    track to an id we do not recognise -- but Spotify still has some of our
 *    chain queued. Anything Spotify has *queued* has not played yet, so the
 *    earliest of ours still in the queue marks the boundary and everything
 *    unplayed before it has been played. This is what catches a song skipped
 *    between two polls, which `currently-playing` alone can never see: by the
 *    next poll it is simply gone.
 *
 * If neither locates us, nothing is marked. Guessing here would be worse than
 * being stale.
 */
export function resolvePlayback(
  entries: readonly PlaybackEntry[],
  reading: PlaybackReading,
): PlaybackResolution {
  const boundary = locateBoundary(entries, reading)
  if (boundary === -1) return { playedEntryIds: [], nowPlayingEntryId: null }

  const playedEntryIds: string[] = []
  for (let i = 0; i < boundary; i += 1) {
    const entry = entries[i]
    if (entry !== undefined && entry.playedAt === null) playedEntryIds.push(entry.id)
  }

  // The song playing right now is not played yet -- it still has most of its
  // duration left to contribute to the runway.
  const current = entries[boundary]
  const isOurs =
    current !== undefined &&
    reading.nowPlayingTrackId !== null &&
    current.trackId === reading.nowPlayingTrackId

  return { playedEntryIds, nowPlayingEntryId: isOurs ? current.id : null }
}

/**
 * The index of the earliest entry that has *not* played, which is where the
 * chain currently sits. Everything before it is behind us. -1 when unknown.
 */
function locateBoundary(entries: readonly PlaybackEntry[], reading: PlaybackReading): number {
  const { nowPlayingTrackId, queuedTrackIds } = reading

  if (nowPlayingTrackId !== null) {
    // Earliest *unplayed* match, not merely the earliest match. A host
    // override can put the same track in the chain twice, and the one playing
    // now is the copy we have not passed yet -- matching the earlier one would
    // rewind the runway over songs that already played.
    const index = entries.findIndex(
      (entry) => entry.playedAt === null && entry.trackId === nowPlayingTrackId,
    )
    if (index !== -1) return index
  }

  if (queuedTrackIds !== null && queuedTrackIds.length > 0) {
    const queued = new Set(queuedTrackIds)
    const index = entries.findIndex(
      (entry) => entry.playedAt === null && queued.has(entry.trackId),
    )
    if (index !== -1) return index
  }

  return -1
}

/** Narrow a stored chain to what the playback decision needs. */
export function toPlaybackEntries(chain: readonly StoredEntry[]): PlaybackEntry[] {
  return chain.map((entry) => ({
    id: entry.id,
    trackId: entry.track.id,
    playedAt: entry.playedAt,
  }))
}

/** Build a reading from what the host's Spotify reported. */
export function toPlaybackReading(
  playback: HostPlayback,
  queue: HostQueue | null,
): PlaybackReading {
  return {
    // Fall back to the queue endpoint's own view of what is playing: the two
    // can disagree for a moment around a track change, and either will do.
    nowPlayingTrackId: playback.trackId ?? queue?.currentTrackId ?? null,
    queuedTrackIds: queue === null ? null : queue.trackIds,
  }
}

/**
 * Stamp entries as played and return the fresh runway.
 *
 * One transaction so the runway a caller broadcasts always matches the rows it
 * just wrote -- otherwise two hosts' polls interleaving could broadcast a
 * runway from between the two writes.
 *
 * `played_at is null` in the UPDATE makes this idempotent: two polls racing
 * with the same reading cannot double-stamp, and the second sees no rows.
 */
export async function markPlayed(
  roomId: string,
  entryIds: readonly string[],
): Promise<{ runway: Runway; markedIds: string[] }> {
  if (entryIds.length === 0) {
    return { runway: await runway(roomId), markedIds: [] }
  }

  return transaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `update chain_entries
       set played_at = now()
       where room_id = $1 and id = any($2::uuid[]) and played_at is null
       returning id`,
      [roomId, entryIds],
    )

    const { rows: totals } = await client.query<{ ms: string | null; songs: string }>(
      `select coalesce(sum(duration_ms), 0)::text as ms, count(*)::text as songs
       from chain_entries
       where room_id = $1 and played_at is null`,
      [roomId],
    )
    const total = totals[0]

    return {
      runway: { ms: Number(total?.ms ?? 0), songs: Number(total?.songs ?? 0) },
      markedIds: rows.map((row) => row.id),
    }
  })
}

/** The chain, reduced to what a playback decision needs, in order. */
export async function playbackEntries(roomId: string): Promise<PlaybackEntry[]> {
  const rows = await query<{ id: string; track_id: string; played_at: Date | null }>(
    `select id, track_id, played_at
     from chain_entries
     where room_id = $1
     order by position`,
    [roomId],
  )
  return rows.map((row) => ({
    id: row.id,
    trackId: row.track_id,
    playedAt: row.played_at === null ? null : row.played_at.toISOString(),
  }))
}
