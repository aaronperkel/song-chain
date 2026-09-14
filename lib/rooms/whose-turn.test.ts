import { describe, expect, it } from 'vitest'
import { turnView } from './whose-turn'
import type { Seat } from './seats'

function seat(overrides: Partial<Seat> & { id: string }): Seat {
  return {
    roomId: 'room',
    name: overrides.id,
    position: 0,
    isHost: false,
    hasPhone: true,
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    removedAt: null,
    ...overrides,
  }
}

const you = seat({ id: 'you', name: 'Sam' })
const driver = seat({ id: 'driver', name: 'Aaron', hasPhone: false, position: 1 })
const other = seat({ id: 'other', name: 'Jo', position: 2 })
const seats = [you, driver, other]

const view = (currentSeatId: string | null, me: { seatId: string | null; isHost: boolean }) =>
  turnView({ seats, turn: { currentSeatId }, you: me })

describe('turnView', () => {
  it('has nobody up before the game starts', () => {
    expect(view(null, { seatId: you.id, isHost: false })).toEqual({ kind: 'nobody' })
  })

  it('knows your own turn', () => {
    expect(view(you.id, { seatId: you.id, isHost: false })).toEqual({ kind: 'yours', seat: you })
  })

  it('leaves a player with a phone to pick for themselves', () => {
    expect(view(other.id, { seatId: you.id, isHost: false })).toEqual({ kind: 'theirs', seat: other })
  })

  it('offers the driver’s turn to anyone holding a seat', () => {
    expect(view(driver.id, { seatId: you.id, isHost: false })).toEqual({
      kind: 'for-them',
      seat: driver,
    })
  })

  it('offers it to a host with no seat of their own', () => {
    expect(view(driver.id, { seatId: null, isHost: true })).toEqual({
      kind: 'for-them',
      seat: driver,
    })
  })

  it('does not offer it to a spectator, whose pick the server would refuse', () => {
    expect(view(driver.id, { seatId: null, isHost: false })).toEqual({
      kind: 'theirs',
      seat: driver,
    })
  })

  it('calls it your turn even when your own seat is marked phoneless', () => {
    // Their phone came back before the host flipped the seat. It is still
    // their turn to take normally, not one to be picked on their behalf.
    const back = seat({ id: 'you', name: 'Sam', hasPhone: false })
    expect(
      turnView({ seats: [back], turn: { currentSeatId: 'you' }, you: { seatId: 'you', isHost: false } }),
    ).toEqual({ kind: 'yours', seat: back })
  })
})
