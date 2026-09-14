import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closePool, query } from '@/lib/db'
import type { AppTrack } from '@/lib/spotify'
import { dropRoom, makeRoom } from '@/test/room-fixture'
import { listChain } from './chain'
import { findRoomById, type Room } from './repo'
import { joinRoom } from './seats'
import { submitPick } from './submit'
import { readTurn, startTurnAtFirstSeat } from './turns'

/**
 * The game, played end to end against the real database: rules engine, turn
 * order and persistence together. Rooms stay in manual mode so nothing
 * reaches Spotify.
 */
let room: Room
let seats: string[] = []

const track = (title: string, artist = 'Various'): AppTrack => ({
  id: Math.random().toString(36).slice(2, 24).padEnd(22, 'x').slice(0, 22),
  uri: 'spotify:track:0000000000000000000000',
  title,
  artists: [artist],
  durationMs: 200_000,
  albumName: null,
  albumArtUrl: null,
  explicit: false,
})

let nonceCounter = 0
const nextNonce = (): string => {
  nonceCounter += 1
  return `nonce-${String(nonceCounter)}-${Math.random().toString(36).slice(2)}`
}

const play = async (
  title: string,
  options: { artist?: string; seatIndex?: number; override?: boolean; nonce?: string } = {},
) =>
  submitPick({
    room,
    track: track(title, options.artist ?? 'Various'),
    seatId: seats[options.seatIndex ?? 0] ?? null,
    clientNonce: options.nonce ?? nextNonce(),
    override: options.override ?? false,
  })

beforeEach(async () => {
  const made = await makeRoom()
  room = made.room
  seats = []
  for (const name of ['A', 'B']) {
    seats.push((await joinRoom(room.id, name)).seat.id)
  }
  await startTurnAtFirstSeat(room.id)
})

afterEach(async () => {
  await dropRoom(room.id)
  await closePool()
})

describe('playing the chain', () => {
  it('accepts the first song as the seed, with nothing to link to', async () => {
    const outcome = await play('Goodbye Yellow Brick Road')
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.entry.isSeed).toBe(true)
    expect(outcome.entry.matchedWord).toBeNull()
  })

  it('links the next song on a shared word', async () => {
    await play('Goodbye Yellow Brick Road', { artist: 'Elton John' })
    const outcome = await play('Yellow Submarine', { artist: 'The Beatles', seatIndex: 1 })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.entry.matchedWord).toBe('Yellow')
    expect(outcome.entry.via).toBe('exact')
    expect(outcome.entry.isSeed).toBe(false)
  })

  it('rejects a song with no shared word, and explains why', async () => {
    await play('Goodbye Yellow Brick Road', { artist: 'Elton John' })
    const outcome = await play('Smells Like Teen Spirit', { artist: 'Nirvana' })

    expect(outcome.ok).toBe(false)
    if (outcome.ok || outcome.reason !== 'rejected') return
    expect(outcome.result).toEqual({ valid: false, reason: 'no-shared-word' })
    expect(outcome.explanation.sharedWords).toEqual([])
    // Nothing was written.
    expect(await listChain(room.id)).toHaveLength(1)
  })

  it('rejects a stopword-only link and says so in words a player can read', async () => {
    await play('The Sound of Silence', { artist: 'Simon & Garfunkel' })
    const outcome = await play('The Chain', { artist: 'Fleetwood Mac' })

    expect(outcome.ok).toBe(false)
    if (outcome.ok || outcome.reason !== 'rejected') return
    expect(outcome.result).toEqual({ valid: false, reason: 'stopword-only' })
    expect(outcome.explanation.sharedWords[0]?.why).toContain('stopword')
  })

  it('does not advance the turn on a rejected pick', async () => {
    await play('Goodbye Yellow Brick Road', { artist: 'Elton John' })
    const turnBefore = (await readTurn(room.id))?.currentSeatId

    await play('Smells Like Teen Spirit', { artist: 'Nirvana' })

    expect((await readTurn(room.id))?.currentSeatId).toBe(turnBefore)
  })

  it('enforces the artist cooldown through the stored chain', async () => {
    await play('Yellow Submarine', { artist: 'Yellow Days' })
    const outcome = await play('Submarine Dreams', { artist: 'Yellow Days' })

    expect(outcome.ok).toBe(false)
    if (outcome.ok || outcome.reason !== 'rejected') return
    expect(outcome.result).toEqual({ valid: false, reason: 'artist-cooldown' })
    expect(outcome.explanation.blockers?.[0]?.kind).toBe('artist-cooldown')
  })

  it('blocks the same song twice, even as a different release', async () => {
    await play('Yellow Submarine', { artist: 'The Beatles' })
    await play('Submarine Bells', { artist: 'The Chills' })
    const outcome = await play('Yellow Submarine - Remastered 2009', { artist: 'The Beatles' })

    expect(outcome.ok).toBe(false)
    if (outcome.ok || outcome.reason !== 'rejected') return
    expect(outcome.result).toEqual({ valid: false, reason: 'duplicate-song' })
  })

  it('matches through release junk on both sides', async () => {
    await play('Goodbye Yellow Brick Road - Remastered 2014', { artist: 'Elton John' })
    const outcome = await play('Yellow Submarine (Remastered 2009)', { artist: 'The Beatles' })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.entry.matchedWord).toBe('Yellow')
  })
})

describe('host override', () => {
  it('records a rejected pick when the host insists', async () => {
    await play('Goodbye Yellow Brick Road', { artist: 'Elton John' })
    const outcome = await play('Smells Like Teen Spirit', { artist: 'Nirvana', override: true })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.entry.wasOverride).toBe(true)
    // No word linked it, and the row says so rather than inventing one.
    expect(outcome.entry.matchedWord).toBeNull()
    expect(await listChain(room.id)).toHaveLength(2)
  })

  it('still advances the turn', async () => {
    await play('Goodbye Yellow Brick Road', { artist: 'Elton John' })
    const before = (await readTurn(room.id))?.currentSeatId
    await play('Smells Like Teen Spirit', { artist: 'Nirvana', override: true })
    expect((await readTurn(room.id))?.currentSeatId).not.toBe(before)
  })
})

describe('retrying a submit', () => {
  it('answers a replay from the chain instead of re-validating', async () => {
    await play('Goodbye Yellow Brick Road', { artist: 'Elton John' })
    const nonce = nextNonce()
    const first = await play('Yellow Submarine', { artist: 'The Beatles', nonce })
    expect(first.ok).toBe(true)

    const replay = await play('Yellow Submarine', { artist: 'The Beatles', nonce })

    expect(replay.ok).toBe(true)
    if (!replay.ok || !first.ok) return
    expect(replay.wasDuplicate).toBe(true)
    expect(replay.entry.id).toBe(first.entry.id)
    expect(await listChain(room.id)).toHaveLength(2)
  })

  it('replays successfully even once the pick would now be a duplicate song', async () => {
    // The retry arrives late; by then the chain contains the very song being
    // submitted, so re-validating would reject its own earlier success.
    await play('Goodbye Yellow Brick Road', { artist: 'Elton John' })
    const nonce = nextNonce()
    await play('Yellow Submarine', { artist: 'The Beatles', nonce })

    const replay = await play('Yellow Submarine', { artist: 'The Beatles', nonce })
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(replay.wasDuplicate).toBe(true)
  })
})

describe('manual mode', () => {
  it('records the pick without claiming it was queued', async () => {
    const outcome = await play('Goodbye Yellow Brick Road')
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.entry.queuedToSpotify).toBe(false)
    expect(outcome.queueWarning).toBeNull()
  })

  it('keeps the deep link so someone can play it by hand', async () => {
    await play('Goodbye Yellow Brick Road')
    const [entry] = await listChain(room.id)
    expect(entry?.track.uri).toMatch(/^spotify:track:/)
  })
})

describe('settings come from the room', () => {
  it('honours a room configured to allow stopword links', async () => {
    await query(`update rooms set settings = '{"stopwords":"allow"}'::jsonb where id = $1`, [
      room.id,
    ])
    const updated = await findRoomById(room.id)
    expect(updated).not.toBeNull()
    if (updated === null) return
    room = updated

    await play('The Sound of Silence', { artist: 'Simon & Garfunkel' })
    const outcome = await play('The Chain', { artist: 'Fleetwood Mac' })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.entry.matchedWord).toBe('The')
  })

  it('honours a room with the artist cooldown switched off', async () => {
    await query(`update rooms set settings = '{"artistCooldown":0}'::jsonb where id = $1`, [room.id])
    const updated = await findRoomById(room.id)
    if (updated === null) return
    room = updated

    await play('Yellow Submarine', { artist: 'Yellow Days' })
    const outcome = await play('Submarine Dreams', { artist: 'Yellow Days' })
    expect(outcome.ok).toBe(true)
  })
})
