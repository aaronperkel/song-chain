import type pg from 'pg'
import { query, queryOne, transaction } from '@/lib/db'

/**
 * Whose turn it is.
 *
 * The server owns this. A client is never trusted to say whose turn it was,
 * because the whole point of turn order is that it cannot be jumped.
 */
export type TurnState = {
  currentSeatId: string | null
  turnStartedAt: string | null
}

type TurnRow = {
  current_seat_id: string | null
  turn_started_at: Date | null
}

function toTurnState(row: TurnRow): TurnState {
  return {
    currentSeatId: row.current_seat_id,
    turnStartedAt: row.turn_started_at === null ? null : row.turn_started_at.toISOString(),
  }
}

export async function readTurn(roomId: string): Promise<TurnState | null> {
  const row = await queryOne<TurnRow>(
    'select current_seat_id, turn_started_at from rooms where id = $1',
    [roomId],
  )
  return row === null ? null : toTurnState(row)
}

/**
 * Move to the next active seat, wrapping around.
 *
 * Reads the seat order inside the caller's transaction, so a pick and the
 * turn it hands on commit together: a queued song with a stale turn pointer
 * would let two people pick at once.
 */
export async function advanceTurn(
  client: pg.PoolClient,
  roomId: string,
): Promise<TurnState> {
  const { rows: seats } = await client.query<{ id: string; position: number }>(
    `select id, position from seats
     where room_id = $1 and removed_at is null
     order by position`,
    [roomId],
  )

  if (seats.length === 0) {
    const { rows } = await client.query<TurnRow>(
      `update rooms set current_seat_id = null, turn_started_at = null
       where id = $1
       returning current_seat_id, turn_started_at`,
      [roomId],
    )
    return toTurnState(rows[0] ?? { current_seat_id: null, turn_started_at: null })
  }

  const { rows: room } = await client.query<{ current_seat_id: string | null }>(
    'select current_seat_id from rooms where id = $1 for update',
    [roomId],
  )
  const currentId = room[0]?.current_seat_id ?? null
  const currentIndex = seats.findIndex((seat) => seat.id === currentId)

  // An unknown or removed current seat restarts at the top rather than
  // stalling the game.
  const next = seats[(currentIndex + 1) % seats.length] as { id: string }

  const { rows } = await client.query<TurnRow>(
    `update rooms set current_seat_id = $2, turn_started_at = now()
     where id = $1
     returning current_seat_id, turn_started_at`,
    [roomId, next.id],
  )
  return toTurnState(rows[0] as TurnRow)
}

/** Point the turn at a specific seat, for the host's skip and pass controls. */
export async function setTurn(roomId: string, seatId: string | null): Promise<TurnState | null> {
  const row = await queryOne<TurnRow>(
    `update rooms set current_seat_id = $2, turn_started_at = case when $2::uuid is null then null else now() end
     where id = $1
     returning current_seat_id, turn_started_at`,
    [roomId, seatId],
  )
  return row === null ? null : toTurnState(row)
}

/**
 * Hand the turn to the next seat without a pick, for the host's skip.
 *
 * Its own transaction because there is no pick to commit alongside it: the
 * seat order is read and the pointer moved together, so a seat leaving
 * mid-skip cannot strand the turn on a removed player.
 */
export async function skipTurn(roomId: string): Promise<TurnState> {
  return transaction(async (client) => advanceTurn(client, roomId))
}

/** Has the current turn run past the room's timer? 0 means no timer. */
export function turnHasExpired(
  turnStartedAt: string | null,
  turnTimerSeconds: number,
  now: number = Date.now(),
): boolean {
  if (turnTimerSeconds <= 0 || turnStartedAt === null) return false
  return now - new Date(turnStartedAt).getTime() > turnTimerSeconds * 1000
}

export async function startTurnAtFirstSeat(roomId: string): Promise<TurnState> {
  return transaction(async (client) => {
    await client.query('update rooms set current_seat_id = null where id = $1', [roomId])
    return advanceTurn(client, roomId)
  })
}

/** Clear the turn pointer, e.g. when the game ends. */
export async function clearTurn(roomId: string): Promise<void> {
  await query(
    'update rooms set current_seat_id = null, turn_started_at = null where id = $1',
    [roomId],
  )
}
