import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closePool } from '@/lib/db'
import type { AppTrack } from '@/lib/spotify'
import { dropRoom, makeRoom } from '@/test/room-fixture'
import { appendPick, findEntryByNonce, lastEntry, listChain, removeLastEntry, runway } from './chain'
import { joinRoom } from './seats'
import { advanceTurn, readTurn, setTurn, startTurnAtFirstSeat } from './turns'
import { transaction } from '@/lib/db'

let roomId = ''
let seats: string[] = []

const track = (title: string, artist = 'Someone', durationMs = 180_000): AppTrack => ({
  id: `track-${title.replace(/\W/g, '')}-${String(Math.random()).slice(2, 8)}`,
  uri: 'spotify:track:0000000000000000000000',
  title,
  artists: [artist],
  durationMs,
  albumName: 'An Album',
  albumArtUrl: null,
  explicit: false,
})

const pick = async (
  title: string,
  options: { seatId?: string; nonce?: string; isSeed?: boolean; durationMs?: number } = {},
) =>
  appendPick({
    roomId,
    track: track(title, 'Someone', options.durationMs),
    matchedWord: options.isSeed === true ? null : 'word',
    matchedOn: options.isSeed === true ? null : 'title',
    via: options.isSeed === true ? null : 'exact',
    seatId: options.seatId ?? seats[0] ?? null,
    isSeed: options.isSeed ?? false,
    wasOverride: false,
    queuedToSpotify: false,
    clientNonce: options.nonce ?? `nonce-${title}-${String(Math.random()).slice(2, 10)}`,
  })

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

describe('appending picks', () => {
  it('numbers the chain from zero', async () => {
    await pick('One', { isSeed: true })
    await pick('Two')
    await pick('Three')

    const chain = await listChain(roomId)
    expect(chain.map((entry) => [entry.position, entry.track.title])).toEqual([
      [0, 'One'],
      [1, 'Two'],
      [2, 'Three'],
    ])
  })

  it('hands the turn on with the pick', async () => {
    expect((await readTurn(roomId))?.currentSeatId).toBe(seats[0])
    const result = await pick('One', { seatId: seats[0] })
    expect(result.turn.currentSeatId).toBe(seats[1])
    expect((await readTurn(roomId))?.currentSeatId).toBe(seats[1])
  })

  it('attributes the pick to a seat, by name', async () => {
    await pick('One', { seatId: seats[1] })
    const entry = await lastEntry(roomId)
    expect(entry?.seatId).toBe(seats[1])
    expect(entry?.seatName).toBe('B')
  })

  it('stores a snapshot of the track, not a reference', async () => {
    const original = track('Goodbye Yellow Brick Road - Remastered 2014', 'Elton John', 192_826)
    await appendPick({
      roomId,
      track: original,
      matchedWord: null,
      matchedOn: null,
      via: null,
      seatId: seats[0] ?? null,
      isSeed: true,
      wasOverride: false,
      queuedToSpotify: true,
      clientNonce: 'snapshot',
    })

    const entry = await lastEntry(roomId)
    expect(entry?.track.title).toBe('Goodbye Yellow Brick Road - Remastered 2014')
    expect(entry?.track.artists).toEqual(['Elton John'])
    expect(entry?.track.durationMs).toBe(192_826)
    expect(entry?.queuedToSpotify).toBe(true)
  })
})

describe('idempotency, which is what dead cell service needs', () => {
  it('applies a replayed nonce once', async () => {
    const first = await pick('One', { nonce: 'same-nonce' })
    const second = await pick('One', { nonce: 'same-nonce' })

    expect(first.wasDuplicate).toBe(false)
    expect(second.wasDuplicate).toBe(true)
    expect(second.entry.id).toBe(first.entry.id)
    expect(await listChain(roomId)).toHaveLength(1)
  })

  it('does not advance the turn twice on a replay', async () => {
    await pick('One', { nonce: 'same-nonce', seatId: seats[0] })
    const turnAfterFirst = (await readTurn(roomId))?.currentSeatId

    const replay = await pick('One', { nonce: 'same-nonce', seatId: seats[0] })

    expect(replay.turn.currentSeatId).toBe(turnAfterFirst)
    expect((await readTurn(roomId))?.currentSeatId).toBe(seats[1])
  })

  it('survives a burst of identical retries', async () => {
    // A phone coming back onto cell service may fire every queued retry at once.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => pick('One', { nonce: 'burst' })),
    )
    expect(results.filter((result) => !result.wasDuplicate)).toHaveLength(1)
    expect(await listChain(roomId)).toHaveLength(1)
  })

  it('lets the same track in under a different nonce, so retries are not confused with picks', async () => {
    await pick('One', { nonce: 'a' })
    await pick('One', { nonce: 'b' })
    expect(await listChain(roomId)).toHaveLength(2)
  })

  it('finds an earlier submit by its nonce', async () => {
    const result = await pick('One', { nonce: 'lookup-me' })
    const found = await findEntryByNonce(roomId, 'lookup-me')
    expect(found?.id).toBe(result.entry.id)
    expect(await findEntryByNonce(roomId, 'never-sent')).toBeNull()
  })

  it('does not collide with concurrent picks under different nonces', async () => {
    const results = await Promise.all([
      pick('One', { nonce: 'x' }),
      pick('Two', { nonce: 'y' }),
      pick('Three', { nonce: 'z' }),
    ])
    expect(results.every((result) => !result.wasDuplicate)).toBe(true)
    expect((await listChain(roomId)).map((entry) => entry.position)).toEqual([0, 1, 2])
  })
})

describe('turn order', () => {
  it('wraps around the table', async () => {
    await transaction(async (client) => {
      await advanceTurn(client, roomId)
      await advanceTurn(client, roomId)
    })
    expect((await readTurn(roomId))?.currentSeatId).toBe(seats[2])

    const wrapped = await transaction(async (client) => advanceTurn(client, roomId))
    expect(wrapped.currentSeatId).toBe(seats[0])
  })

  it('restarts at the top when the current seat has left', async () => {
    await setTurn(roomId, seats[1] ?? null)
    const { removeSeat } = await import('./seats')
    await removeSeat(roomId, seats[1] as string)

    const next = await transaction(async (client) => advanceTurn(client, roomId))
    expect(next.currentSeatId).toBe(seats[0])
  })

  it('clears the turn when the last player leaves', async () => {
    const { removeSeat } = await import('./seats')
    for (const seatId of seats) await removeSeat(roomId, seatId)

    const next = await transaction(async (client) => advanceTurn(client, roomId))
    expect(next.currentSeatId).toBeNull()
    expect(next.turnStartedAt).toBeNull()
  })

  it('stamps when the turn started, for the timer', async () => {
    const before = Date.now() - 1000
    const next = await transaction(async (client) => advanceTurn(client, roomId))
    expect(new Date(next.turnStartedAt ?? 0).getTime()).toBeGreaterThan(before)
  })
})

describe('undo', () => {
  it('removes the last pick and hands the turn back to whoever made it', async () => {
    await pick('One', { isSeed: true, seatId: seats[0] })
    await pick('Two', { seatId: seats[1] })
    expect((await readTurn(roomId))?.currentSeatId).toBe(seats[2])

    const undone = await removeLastEntry(roomId)

    expect(undone?.track.title).toBe('Two')
    expect(await listChain(roomId)).toHaveLength(1)
    // Their turn again, so undo actually lets them pick something else.
    expect((await readTurn(roomId))?.currentSeatId).toBe(seats[1])
  })

  it('frees the position so the next pick reuses it', async () => {
    await pick('One')
    await pick('Two')
    await removeLastEntry(roomId)
    await pick('Three')

    expect((await listChain(roomId)).map((entry) => [entry.position, entry.track.title])).toEqual([
      [0, 'One'],
      [1, 'Three'],
    ])
  })

  it('returns null on an empty chain', async () => {
    expect(await removeLastEntry(roomId)).toBeNull()
  })
})

describe('runway', () => {
  it('sums unplayed duration and count', async () => {
    await pick('One', { durationMs: 180_000 })
    await pick('Two', { durationMs: 240_000 })
    expect(await runway(roomId)).toEqual({ ms: 420_000, songs: 2 })
  })

  it('excludes what has already played', async () => {
    await pick('One', { durationMs: 180_000 })
    await pick('Two', { durationMs: 240_000 })
    const { query } = await import('@/lib/db')
    await query('update chain_entries set played_at = now() where position = 0 and room_id = $1', [
      roomId,
    ])
    expect(await runway(roomId)).toEqual({ ms: 240_000, songs: 1 })
  })

  it('is zero on an empty chain', async () => {
    expect(await runway(roomId)).toEqual({ ms: 0, songs: 0 })
  })
})
