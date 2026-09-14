import type pg from 'pg'
import type { ChainEntry, MatchedOn, Track, Via } from '@/lib/rules'
import type { AppTrack } from '@/lib/spotify'
import { query, queryOne, transaction } from '@/lib/db'
import { advanceTurn, type TurnState } from './turns'

/**
 * The chain, as stored.
 *
 * Rows hold a snapshot of the track rather than just an id: a remaster can
 * replace a title on Spotify, but the chain has to keep saying what was
 * actually played and which word actually linked it.
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

type EntryRow = {
  id: string
  position: number
  track_id: string
  track_uri: string
  title: string
  artists: string[]
  duration_ms: number
  album_name: string | null
  album_art_url: string | null
  matched_word: string | null
  matched_on: MatchedOn | null
  via: Via | null
  seat_id: string | null
  seat_name: string | null
  is_seed: boolean
  was_override: boolean
  queued_to_spotify: boolean
  played_at: Date | null
  created_at: Date
}

const ENTRY_COLUMNS = `
  e.id, e.position, e.track_id, e.track_uri, e.title, e.artists, e.duration_ms,
  e.album_name, e.album_art_url, e.matched_word, e.matched_on, e.via,
  e.seat_id, s.name as seat_name, e.is_seed, e.was_override,
  e.queued_to_spotify, e.played_at, e.created_at
`

function toStoredEntry(row: EntryRow): StoredEntry {
  return {
    id: row.id,
    position: row.position,
    track: {
      id: row.track_id,
      uri: row.track_uri,
      title: row.title,
      artists: row.artists,
      durationMs: row.duration_ms,
      albumName: row.album_name,
      albumArtUrl: row.album_art_url,
      explicit: false,
    },
    matchedWord: row.matched_word,
    matchedOn: row.matched_on,
    via: row.via,
    seatId: row.seat_id,
    seatName: row.seat_name,
    isSeed: row.is_seed,
    wasOverride: row.was_override,
    queuedToSpotify: row.queued_to_spotify,
    playedAt: row.played_at === null ? null : row.played_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  }
}

/** The rules engine only wants the fields it declares. */
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

export async function listChain(roomId: string): Promise<StoredEntry[]> {
  const rows = await query<EntryRow>(
    `select ${ENTRY_COLUMNS}
     from chain_entries e
     left join seats s on s.id = e.seat_id
     where e.room_id = $1
     order by e.position`,
    [roomId],
  )
  return rows.map(toStoredEntry)
}

export async function lastEntry(roomId: string): Promise<StoredEntry | null> {
  const row = await queryOne<EntryRow>(
    `select ${ENTRY_COLUMNS}
     from chain_entries e
     left join seats s on s.id = e.seat_id
     where e.room_id = $1
     order by e.position desc
     limit 1`,
    [roomId],
  )
  return row === null ? null : toStoredEntry(row)
}

/** An earlier submit that already landed, found by its idempotency key. */
export async function findEntryByNonce(
  roomId: string,
  clientNonce: string,
): Promise<StoredEntry | null> {
  const row = await queryOne<EntryRow>(
    `select ${ENTRY_COLUMNS}
     from chain_entries e
     left join seats s on s.id = e.seat_id
     where e.room_id = $1 and e.client_nonce = $2`,
    [roomId, clientNonce],
  )
  return row === null ? null : toStoredEntry(row)
}

export type AppendPick = {
  roomId: string
  track: AppTrack
  matchedWord: string | null
  matchedOn: MatchedOn | null
  via: Via | null
  seatId: string | null
  isSeed: boolean
  wasOverride: boolean
  queuedToSpotify: boolean
  clientNonce: string
}

export type AppendResult = {
  entry: StoredEntry
  turn: TurnState
  /** True when this nonce had already been applied. */
  wasDuplicate: boolean
}

/**
 * Append a pick and hand on the turn, atomically.
 *
 * These two must commit together. A song in the chain with the turn still
 * pointing at the player who submitted it lets them pick twice; a turn
 * advanced without the song loses the pick entirely.
 *
 * The insert is guarded by (room_id, client_nonce), so a retry after a lost
 * response returns the original entry instead of adding a second copy -- the
 * behaviour dead cell service depends on.
 */
export async function appendPick(pick: AppendPick): Promise<AppendResult> {
  return transaction(async (client) => {
    // Serialise picks within a room so two submits cannot claim one position.
    await client.query('select id from rooms where id = $1 for update', [pick.roomId])

    const { rows: inserted } = await client.query<{ id: string }>(
      `insert into chain_entries (
         room_id, position, track_id, track_uri, title, artists, duration_ms,
         album_name, album_art_url, matched_word, matched_on, via, seat_id,
         is_seed, was_override, queued_to_spotify, client_nonce
       )
       select
         $1,
         coalesce((select max(position) + 1 from chain_entries where room_id = $1), 0),
         $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
       on conflict (room_id, client_nonce) do nothing
       returning id`,
      [
        pick.roomId,
        pick.track.id,
        pick.track.uri,
        pick.track.title,
        pick.track.artists,
        pick.track.durationMs,
        pick.track.albumName,
        pick.track.albumArtUrl,
        pick.matchedWord,
        pick.matchedOn,
        pick.via,
        pick.seatId,
        pick.isSeed,
        pick.wasOverride,
        pick.queuedToSpotify,
        pick.clientNonce,
      ],
    )

    const wasDuplicate = inserted.length === 0

    const { rows: entryRows } = await client.query<EntryRow>(
      `select ${ENTRY_COLUMNS}
       from chain_entries e
       left join seats s on s.id = e.seat_id
       where e.room_id = $1 and e.client_nonce = $2`,
      [pick.roomId, pick.clientNonce],
    )
    const entryRow = entryRows[0]
    if (entryRow === undefined) throw new Error('Pick vanished after insert')

    // A replayed submit must not advance the turn a second time.
    const turn = wasDuplicate
      ? await readTurnIn(client, pick.roomId)
      : await advanceTurn(client, pick.roomId)

    return { entry: toStoredEntry(entryRow), turn, wasDuplicate }
  })
}

async function readTurnIn(client: pg.PoolClient, roomId: string): Promise<TurnState> {
  const { rows } = await client.query<{ current_seat_id: string | null; turn_started_at: Date | null }>(
    'select current_seat_id, turn_started_at from rooms where id = $1',
    [roomId],
  )
  const row = rows[0]
  return {
    currentSeatId: row?.current_seat_id ?? null,
    turnStartedAt: row?.turn_started_at?.toISOString() ?? null,
  }
}

/**
 * Remove the last pick, for the host's undo.
 *
 * Spotify has no remove-from-queue API, so this only takes the song out of
 * the chain. The UI has to say so plainly.
 */
export async function removeLastEntry(roomId: string): Promise<StoredEntry | null> {
  return transaction(async (client) => {
    await client.query('select id from rooms where id = $1 for update', [roomId])

    const { rows } = await client.query<EntryRow>(
      `select ${ENTRY_COLUMNS}
       from chain_entries e
       left join seats s on s.id = e.seat_id
       where e.room_id = $1
       order by e.position desc
       limit 1`,
      [roomId],
    )
    const row = rows[0]
    if (row === undefined) return null

    await client.query('delete from chain_entries where id = $1', [row.id])

    // Hand the turn back to whoever picked it, so undo actually lets them
    // pick again.
    if (row.seat_id !== null) {
      await client.query(
        'update rooms set current_seat_id = $2, turn_started_at = now() where id = $1',
        [roomId, row.seat_id],
      )
    }

    return toStoredEntry(row)
  })
}

/** Total unplayed milliseconds and count: the queue runway. */
export async function runway(roomId: string): Promise<{ ms: number; songs: number }> {
  const row = await queryOne<{ ms: string | null; songs: string }>(
    `select coalesce(sum(duration_ms), 0)::text as ms, count(*)::text as songs
     from chain_entries
     where room_id = $1 and played_at is null`,
    [roomId],
  )
  return {
    ms: Number(row?.ms ?? 0),
    songs: Number(row?.songs ?? 0),
  }
}
