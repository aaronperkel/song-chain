import type pg from 'pg'
import { hashSecret, newSecret, secretMatches } from '@/lib/crypto/seal'
import { query, queryOne, transaction } from '@/lib/db'

/** A seat at the table: one player, one position in the turn order. */
export type Seat = {
  id: string
  roomId: string
  name: string
  /** Null once removed: a removed seat gives up its place. */
  position: number | null
  isHost: boolean
  /**
   * False when no phone holds this seat -- the driver, or a dead battery.
   * Its turn is filled by whoever is quickest, and the pick is still theirs.
   */
  hasPhone: boolean
  lastSeenAt: string
  removedAt: string | null
}

type SeatRow = {
  id: string
  room_id: string
  name: string
  position: number | null
  is_host: boolean
  has_phone: boolean
  last_seen_at: Date
  removed_at: Date | null
}

const SEAT_COLUMNS = 'id, room_id, name, position, is_host, has_phone, last_seen_at, removed_at'

function toSeat(row: SeatRow): Seat {
  return {
    id: row.id,
    roomId: row.room_id,
    name: row.name,
    position: row.position,
    isHost: row.is_host,
    hasPhone: row.has_phone,
    lastSeenAt: row.last_seen_at.toISOString(),
    removedAt: row.removed_at === null ? null : row.removed_at.toISOString(),
  }
}

export const MAX_SEATS = 12
export const MAX_NAME_LENGTH = 24

export class SeatError extends Error {
  readonly code: 'room-full' | 'duplicate-name' | 'no-seat' | 'bad-order'
  constructor(code: SeatError['code'], message: string) {
    super(message)
    this.name = 'SeatError'
    this.code = code
  }
}

/** Active seats in turn order. Removed players are excluded. */
export async function listSeats(roomId: string): Promise<Seat[]> {
  const rows = await query<SeatRow>(
    `select ${SEAT_COLUMNS} from seats
     where room_id = $1 and removed_at is null
     order by position`,
    [roomId],
  )
  return rows.map(toSeat)
}

export async function findSeat(seatId: string): Promise<Seat | null> {
  const row = await queryOne<SeatRow>(`select ${SEAT_COLUMNS} from seats where id = $1`, [seatId])
  return row === null ? null : toSeat(row)
}

/**
 * Take a seat in a room.
 *
 * Reconnecting is handled by the seat cookie, not by matching names: two
 * people called "Sam" are two players, and silently handing someone an
 * existing seat because the name matched would let anyone steal a turn. A
 * player who genuinely lost their cookie gets their seat passed to them by
 * the host instead.
 *
 * `hasPhone: false` seats somebody who is playing without a screen -- the
 * driver. A secret is still minted and still nobody holds it, which is the
 * safe direction: the seat is proxied because the flag says so, never because
 * a token happened to be guessable.
 */
export async function joinRoom(
  roomId: string,
  name: string,
  options: { isHost?: boolean; hasPhone?: boolean } = {},
): Promise<{ seat: Seat; secret: string }> {
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH)
  const secret = newSecret()

  const seat = await transaction(async (client) => {
    // Lock the *room* row, not the seat rows. `for update` on a select that
    // matches nothing locks nothing, so locking seats leaves the first
    // joiners unserialised -- everyone scanning the QR code at once then
    // computes position 0 and the insert collides.
    await client.query('select id from rooms where id = $1 for update', [roomId])

    const { rows: existing } = await client.query<{ taken: number; next: number }>(
      `select count(*)::int as taken, coalesce(max(position) + 1, 0)::int as next
       from seats
       where room_id = $1 and removed_at is null`,
      [roomId],
    )
    const counts = existing[0] ?? { taken: 0, next: 0 }

    if (counts.taken >= MAX_SEATS) {
      throw new SeatError('room-full', `A room holds at most ${String(MAX_SEATS)} players`)
    }

    const nextPosition = counts.next
    const { rows } = await client.query<SeatRow>(
      `insert into seats (room_id, name, position, is_host, has_phone, player_token_hash)
       values ($1, $2, $3, $4, $5, $6)
       returning ${SEAT_COLUMNS}`,
      [
        roomId,
        trimmed,
        nextPosition,
        options.isHost ?? false,
        options.hasPhone ?? true,
        hashSecret(secret),
      ],
    )

    const row = rows[0]
    if (row === undefined) throw new SeatError('no-seat', 'Could not take a seat')
    return toSeat(row)
  })

  return { seat, secret }
}

/** Does this secret hold this seat? */
export async function seatMatches(seatId: string, secret: string): Promise<boolean> {
  const row = await queryOne<{ player_token_hash: string; removed_at: Date | null }>(
    'select player_token_hash, removed_at from seats where id = $1',
    [seatId],
  )
  if (row === null || row.removed_at !== null) return false
  return secretMatches(secret, row.player_token_hash)
}

/** Presence ping. Cheap enough to call on every poll. */
export async function touchSeat(seatId: string): Promise<void> {
  await query('update seats set last_seen_at = now() where id = $1', [seatId])
}

export async function renameSeat(seatId: string, name: string): Promise<Seat | null> {
  const row = await queryOne<SeatRow>(
    `update seats set name = $2 where id = $1 and removed_at is null returning ${SEAT_COLUMNS}`,
    [seatId, name.trim().slice(0, MAX_NAME_LENGTH)],
  )
  return row === null ? null : toSeat(row)
}

/**
 * Put the seats in the given order.
 *
 * Rewrites every position in one statement, which is why the unique
 * constraint on (room_id, position) is deferrable -- an immediate one would
 * fail against itself halfway through.
 */
export async function reorderSeats(roomId: string, orderedSeatIds: readonly string[]): Promise<Seat[]> {
  return transaction(async (client) => {
    const { rows: current } = await client.query<{ id: string }>(
      'select id from seats where room_id = $1 and removed_at is null for update',
      [roomId],
    )
    const currentIds = new Set(current.map((row) => row.id))

    // The order has to be a permutation of exactly the active seats, or
    // positions end up duplicated or missing.
    if (
      orderedSeatIds.length !== currentIds.size ||
      new Set(orderedSeatIds).size !== orderedSeatIds.length ||
      !orderedSeatIds.every((id) => currentIds.has(id))
    ) {
      throw new SeatError('bad-order', 'The order must list every active seat exactly once')
    }

    await client.query(
      `update seats set position = ordering.position
       from (select id, ordinality - 1 as position
             from unnest($2::uuid[]) with ordinality as t(id, ordinality)) as ordering
       where seats.id = ordering.id and seats.room_id = $1`,
      [roomId, orderedSeatIds],
    )

    return readSeatsFor(client, roomId)
  })
}

export async function shuffleSeats(roomId: string): Promise<Seat[]> {
  const seats = await listSeats(roomId)
  const ids = seats.map((seat) => seat.id)
  // Fisher-Yates, so every order is equally likely.
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = ids[i] as string
    const b = ids[j] as string
    ids[i] = b
    ids[j] = a
  }
  return reorderSeats(roomId, ids)
}

/**
 * Remove a player, closing the gap in the turn order.
 *
 * A soft delete: their picks stay attributed. If it was their turn, the
 * caller advances it -- this function only reports that it was.
 */
export async function removeSeat(
  roomId: string,
  seatId: string,
): Promise<{ seats: Seat[]; wasCurrent: boolean }> {
  return transaction(async (client) => {
    const { rows: room } = await client.query<{ current_seat_id: string | null }>(
      'select current_seat_id from rooms where id = $1 for update',
      [roomId],
    )
    const wasCurrent = room[0]?.current_seat_id === seatId

    // The position goes with them: a removed seat holding on to its place
    // blocks the gap from closing.
    await client.query(
      `update seats set removed_at = now(), position = null
       where id = $1 and room_id = $2 and removed_at is null`,
      [seatId, roomId],
    )

    // Close the gap so positions stay contiguous from 0.
    await client.query(
      `update seats set position = ordering.position
       from (select id, row_number() over (order by position) - 1 as position
             from seats where room_id = $1 and removed_at is null) as ordering
       where seats.id = ordering.id`,
      [roomId],
    )

    if (wasCurrent) {
      await client.query('update rooms set current_seat_id = null where id = $1', [roomId])
    }

    return { seats: await readSeatsFor(client, roomId), wasCurrent }
  })
}

/**
 * Hand a seat to a different device.
 *
 * For the player whose phone died or who cleared their cookies: rotating the
 * token invalidates the old device and yields a one-time secret the host can
 * give to the new one. Without this, a lost cookie means a lost seat for the
 * rest of the game.
 *
 * A phone taking the seat ends the proxy arrangement: they can see the screen
 * again, so they pick for themselves.
 */
export async function passSeat(
  roomId: string,
  seatId: string,
): Promise<{ seat: Seat; secret: string } | null> {
  const secret = newSecret()
  const row = await queryOne<SeatRow>(
    `update seats set player_token_hash = $3, has_phone = true
     where id = $1 and room_id = $2 and removed_at is null
     returning ${SEAT_COLUMNS}`,
    [seatId, roomId, hashSecret(secret)],
  )
  return row === null ? null : { seat: toSeat(row), secret }
}

/**
 * Say whether a phone holds this seat.
 *
 * Deliberately *not* a token operation. Turning it off leaves the seat's
 * secret alone, so a phone that comes back from a dead battery still has its
 * seat, and turning it back on is a plain flip rather than a re-issue the
 * host would have to read out. The flag answers one question only: may
 * somebody else pick for this seat.
 */
export async function setSeatPhone(
  roomId: string,
  seatId: string,
  hasPhone: boolean,
): Promise<Seat | null> {
  const row = await queryOne<SeatRow>(
    `update seats set has_phone = $3
     where id = $1 and room_id = $2 and removed_at is null
     returning ${SEAT_COLUMNS}`,
    [seatId, roomId, hasPhone],
  )
  return row === null ? null : toSeat(row)
}

async function readSeatsFor(client: pg.PoolClient, roomId: string): Promise<Seat[]> {
  const { rows } = await client.query<SeatRow>(
    `select ${SEAT_COLUMNS} from seats
     where room_id = $1 and removed_at is null
     order by position`,
    [roomId],
  )
  return rows.map(toSeat)
}
