import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closePool } from '@/lib/db'
import { dropRoom, makeRoom } from '@/test/room-fixture'
import {
  joinRoom,
  listSeats,
  passSeat,
  removeSeat,
  renameSeat,
  reorderSeats,
  seatMatches,
  shuffleSeats,
  MAX_SEATS,
  SeatError,
} from './seats'

let roomId = ''

beforeEach(async () => {
  const { room } = await makeRoom()
  roomId = room.id
})

afterEach(async () => {
  await dropRoom(roomId)
  await closePool()
})

const join = async (name: string): Promise<string> => (await joinRoom(roomId, name)).seat.id

describe('taking a seat', () => {
  it('assigns contiguous positions in join order', async () => {
    await join('Aaron')
    await join('Sam')
    await join('Jo')

    const seats = await listSeats(roomId)
    expect(seats.map((seat) => [seat.name, seat.position])).toEqual([
      ['Aaron', 0],
      ['Sam', 1],
      ['Jo', 2],
    ])
  })

  it('gives two people with the same name two seats', async () => {
    // Matching on name would let anyone steal a turn by typing it.
    await join('Sam')
    await join('Sam')
    expect(await listSeats(roomId)).toHaveLength(2)
  })

  it('trims and caps the name', async () => {
    const { seat } = await joinRoom(roomId, `   ${'x'.repeat(40)}   `)
    expect(seat.name).toHaveLength(24)
  })

  it('does not collide when several people join at once', async () => {
    // Everyone scanning the QR code at the same time is the normal case.
    await Promise.all(
      Array.from({ length: 6 }, (_unused, i) => joinRoom(roomId, `Player ${String(i)}`)),
    )
    const seats = await listSeats(roomId)
    expect(seats).toHaveLength(6)
    expect(seats.map((seat) => seat.position)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('refuses to overfill a car', async () => {
    await Promise.all(
      Array.from({ length: MAX_SEATS }, (_unused, i) => joinRoom(roomId, `P${String(i)}`)),
    )
    await expect(joinRoom(roomId, 'one too many')).rejects.toThrow(SeatError)
  })

  it('issues a secret that identifies the seat, stored only as a hash', async () => {
    const { seat, secret } = await joinRoom(roomId, 'Aaron')
    expect(await seatMatches(seat.id, secret)).toBe(true)
    expect(await seatMatches(seat.id, 'wrong-secret')).toBe(false)
  })
})

describe('reordering', () => {
  it('rewrites every position in one statement', async () => {
    const a = await join('A')
    const b = await join('B')
    const c = await join('C')

    const seats = await reorderSeats(roomId, [c, a, b])
    expect(seats.map((seat) => seat.name)).toEqual(['C', 'A', 'B'])
    expect(seats.map((seat) => seat.position)).toEqual([0, 1, 2])
  })

  it('swaps two seats, which an immediate unique constraint would reject', async () => {
    const a = await join('A')
    const b = await join('B')
    const seats = await reorderSeats(roomId, [b, a])
    expect(seats.map((seat) => seat.name)).toEqual(['B', 'A'])
  })

  it('rejects an order that is not a permutation of the active seats', async () => {
    const a = await join('A')
    const b = await join('B')

    await expect(reorderSeats(roomId, [a])).rejects.toThrow(/every active seat/)
    await expect(reorderSeats(roomId, [a, a])).rejects.toThrow(/every active seat/)
    await expect(reorderSeats(roomId, [a, b, a])).rejects.toThrow(/every active seat/)
  })

  it('shuffles without losing or duplicating anyone', async () => {
    const ids = [await join('A'), await join('B'), await join('C'), await join('D')]
    const seats = await shuffleSeats(roomId)
    expect(new Set(seats.map((seat) => seat.id))).toEqual(new Set(ids))
    expect(seats.map((seat) => seat.position)).toEqual([0, 1, 2, 3])
  })
})

describe('removing a player', () => {
  it('closes the gap in the turn order', async () => {
    await join('A')
    const b = await join('B')
    await join('C')

    const { seats } = await removeSeat(roomId, b)
    expect(seats.map((seat) => [seat.name, seat.position])).toEqual([
      ['A', 0],
      ['C', 1],
    ])
  })

  it('keeps the seat row, so past picks stay attributed', async () => {
    const a = await join('A')
    await removeSeat(roomId, a)
    // Soft delete: gone from the table, still on the row.
    expect(await listSeats(roomId)).toHaveLength(0)
    const { rows } = await import('@/lib/db').then(async (db) => ({
      rows: await db.query<{ removed_at: Date | null }>(
        'select removed_at from seats where id = $1',
        [a],
      ),
    }))
    expect(rows[0]?.removed_at).not.toBeNull()
  })

  it('reports whether it was that player’s turn', async () => {
    const a = await join('A')
    await join('B')
    const { setTurn } = await import('./turns')
    await setTurn(roomId, a)

    const removed = await removeSeat(roomId, a)
    expect(removed.wasCurrent).toBe(true)
  })

  it('is idempotent', async () => {
    const a = await join('A')
    await removeSeat(roomId, a)
    await expect(removeSeat(roomId, a)).resolves.toMatchObject({ wasCurrent: false })
  })
})

describe('passing a seat to another device', () => {
  it('invalidates the old secret and issues a new one', async () => {
    const { seat, secret } = await joinRoom(roomId, 'Aaron')

    const passed = await passSeat(roomId, seat.id)
    expect(passed).not.toBeNull()
    // The phone that died can no longer act as this player.
    expect(await seatMatches(seat.id, secret)).toBe(false)
    expect(await seatMatches(seat.id, passed?.secret ?? '')).toBe(true)
  })

  it('keeps the name and position', async () => {
    await join('A')
    const { seat } = await joinRoom(roomId, 'B')
    const passed = await passSeat(roomId, seat.id)
    expect(passed?.seat.name).toBe('B')
    expect(passed?.seat.position).toBe(1)
  })

  it('will not pass a removed seat', async () => {
    const a = await join('A')
    await removeSeat(roomId, a)
    expect(await passSeat(roomId, a)).toBeNull()
  })
})

describe('renaming', () => {
  it('renames an active seat', async () => {
    const a = await join('A')
    expect((await renameSeat(a, 'Aaron'))?.name).toBe('Aaron')
  })

  it('returns null for a removed seat', async () => {
    const a = await join('A')
    await removeSeat(roomId, a)
    expect(await renameSeat(a, 'Nope')).toBeNull()
  })
})
