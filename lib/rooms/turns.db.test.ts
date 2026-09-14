import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closePool } from '@/lib/db'
import { dropRoom, makeRoom } from '@/test/room-fixture'
import { removeSeat, joinRoom } from './seats'
import { clearTurn, readTurn, skipTurn, startTurnAtFirstSeat } from './turns'

/**
 * The host's skip, for when the person whose turn it is has fallen asleep.
 *
 * The failure that matters is a turn pointer left on somebody who cannot pick,
 * because a cooperative game with no lose condition simply stops until a human
 * notices.
 */
let roomId = ''
let seats: string[] = []

beforeEach(async () => {
  const { room } = await makeRoom()
  roomId = room.id
  seats = []
  for (const name of ['A', 'B', 'C']) {
    seats.push((await joinRoom(roomId, name)).seat.id)
  }
  await startTurnAtFirstSeat(roomId)
})

afterEach(async () => {
  await dropRoom(roomId)
  await closePool()
})

describe('skipTurn', () => {
  it('hands the turn to the next seat in order', async () => {
    expect((await readTurn(roomId))?.currentSeatId).toBe(seats[0])

    const turn = await skipTurn(roomId)

    expect(turn.currentSeatId).toBe(seats[1])
  })

  it('wraps around at the end of the order', async () => {
    await skipTurn(roomId)
    await skipTurn(roomId)
    const turn = await skipTurn(roomId)

    expect(turn.currentSeatId).toBe(seats[0])
  })

  it('restarts the turn clock, so the timer is not inherited', async () => {
    const before = (await readTurn(roomId))?.turnStartedAt
    const turn = await skipTurn(roomId)

    expect(turn.turnStartedAt).not.toBeNull()
    expect(turn.turnStartedAt).not.toBe(before)
  })

  it('skips over a seat that has left', async () => {
    const leaving = seats[1]
    if (leaving === undefined) throw new Error('fixture seat missing')
    await removeSeat(roomId, leaving)

    const turn = await skipTurn(roomId)

    expect(turn.currentSeatId).toBe(seats[2])
  })

  it('leaves the turn empty when nobody is left to take it', async () => {
    for (const seat of seats) await removeSeat(roomId, seat)

    const turn = await skipTurn(roomId)

    expect(turn.currentSeatId).toBeNull()
  })

  it('starts at the top when there is no current seat', async () => {
    // A cleared pointer must not strand the game: the next skip picks it up.
    await clearTurn(roomId)

    const turn = await skipTurn(roomId)

    expect(turn.currentSeatId).toBe(seats[0])
  })
})
