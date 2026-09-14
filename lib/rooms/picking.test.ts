import { describe, expect, it } from 'vitest'
import { authorizePick, type PickRequest } from './picking'

const DRIVER = { id: 'seat-driver', name: 'Aaron', hasPhone: false }
const PASSENGER = { id: 'seat-passenger', name: 'Sam', hasPhone: true }

function request(overrides: Partial<PickRequest> = {}): PickRequest {
  return {
    callerSeatId: PASSENGER.id,
    isHost: false,
    wantsOverride: false,
    forSeat: null,
    turn: { currentSeatId: PASSENGER.id, turnStartedAt: null },
    turnTimer: 0,
    ...overrides,
  }
}

describe('picking for yourself', () => {
  it('allows the seat whose turn it is', () => {
    expect(authorizePick(request())).toEqual({
      ok: true,
      seatId: PASSENGER.id,
      onBehalf: false,
      requireTurnAt: PASSENGER.id,
    })
  })

  it('refuses a seat that is not up', () => {
    const result = authorizePick(request({ turn: { currentSeatId: DRIVER.id, turnStartedAt: null } }))
    expect(result).toMatchObject({ ok: false, status: 409, error: 'not-your-turn' })
  })

  it('lets anyone pick once the turn timer has run out', () => {
    const result = authorizePick(
      request({
        turn: { currentSeatId: DRIVER.id, turnStartedAt: new Date(0).toISOString() },
        turnTimer: 30,
        now: 60_000,
      }),
    )
    // Allowed because the timer ran out rather than because the turn was
    // theirs, so there is no pointer for them to be held to.
    expect(result).toEqual({
      ok: true,
      seatId: PASSENGER.id,
      onBehalf: false,
      requireTurnAt: null,
    })
  })

  it('lets the host pick out of turn', () => {
    const result = authorizePick(
      request({ isHost: true, turn: { currentSeatId: DRIVER.id, turnStartedAt: null } }),
    )
    expect(result).toEqual({
      ok: true,
      seatId: PASSENGER.id,
      onBehalf: false,
      requireTurnAt: null,
    })
  })

  it('attributes a seatless host pick to nobody rather than refusing it', () => {
    const result = authorizePick(request({ callerSeatId: null, isHost: true }))
    expect(result).toEqual({ ok: true, seatId: null, onBehalf: false, requireTurnAt: null })
  })

  it('refuses a spectator', () => {
    const result = authorizePick(request({ callerSeatId: null }))
    expect(result).toMatchObject({ ok: false, status: 403, error: 'no-seat' })
  })
})

describe('picking for the driver', () => {
  it('credits the song to the seat it was picked for, not the typist', () => {
    const result = authorizePick(
      request({ forSeat: DRIVER, turn: { currentSeatId: DRIVER.id, turnStartedAt: null } }),
    )
    expect(result).toEqual({
      ok: true,
      seatId: DRIVER.id,
      onBehalf: true,
      // What stops a second passenger's song landing on the same turn.
      requireTurnAt: DRIVER.id,
    })
  })

  it('refuses a seat that has its own phone', () => {
    const result = authorizePick(
      request({
        callerSeatId: 'seat-other',
        forSeat: PASSENGER,
        turn: { currentSeatId: PASSENGER.id, turnStartedAt: null },
      }),
    )
    expect(result).toMatchObject({ ok: false, status: 409, error: 'has-phone' })
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('Sam') })
  })

  it('refuses when it is not that seat’s turn, so only one person can win the race', () => {
    const result = authorizePick(
      request({ forSeat: DRIVER, turn: { currentSeatId: PASSENGER.id, turnStartedAt: null } }),
    )
    expect(result).toMatchObject({ ok: false, status: 409, error: 'not-their-turn' })
  })

  it('ignores an expired timer, which would otherwise hand the song to the wrong player', () => {
    const result = authorizePick(
      request({
        forSeat: DRIVER,
        turn: { currentSeatId: PASSENGER.id, turnStartedAt: new Date(0).toISOString() },
        turnTimer: 30,
        now: 60_000,
      }),
    )
    expect(result).toMatchObject({ ok: false, error: 'not-their-turn' })
  })

  it('lets the host pick for the driver out of turn', () => {
    const result = authorizePick(
      request({
        isHost: true,
        forSeat: DRIVER,
        turn: { currentSeatId: PASSENGER.id, turnStartedAt: null },
      }),
    )
    expect(result).toMatchObject({ ok: true, seatId: DRIVER.id, onBehalf: true })
  })

  it('refuses a spectator even when the driver is up', () => {
    const result = authorizePick(
      request({
        callerSeatId: null,
        forSeat: DRIVER,
        turn: { currentSeatId: DRIVER.id, turnStartedAt: null },
      }),
    )
    expect(result).toMatchObject({ ok: false, status: 403, error: 'no-seat' })
  })
})

describe('override', () => {
  it('is the host’s alone', () => {
    const result = authorizePick(request({ wantsOverride: true }))
    expect(result).toMatchObject({ ok: false, status: 403, error: 'not-host' })
  })

  it('travels with a pick made for the driver', () => {
    const result = authorizePick(
      request({
        isHost: true,
        wantsOverride: true,
        forSeat: DRIVER,
        turn: { currentSeatId: DRIVER.id, turnStartedAt: null },
      }),
    )
    expect(result).toMatchObject({ ok: true, seatId: DRIVER.id, onBehalf: true })
  })
})
