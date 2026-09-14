import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closePool } from '@/lib/db'
import type { AppTrack } from '@/lib/spotify'
import { dropRoom, makeRoom } from '@/test/room-fixture'
import { appendPick, listChain, runway } from './chain'
import { markPlayed, playbackEntries, resolvePlayback } from './playback'
import { joinRoom } from './seats'
import { startTurnAtFirstSeat } from './turns'

/**
 * The runway is a number a car full of people plans around, so the write that
 * moves it has to be exactly as conservative as the decision that feeds it.
 * These tests cover the part `resolvePlayback`'s unit tests cannot: that the
 * stamp is idempotent under the retries a flaky connection produces.
 */
let roomId = ''
let seatId = ''

const track = (title: string, durationMs: number): AppTrack => ({
  id: `track-${title.replace(/\W/g, '')}-${String(Math.random()).slice(2, 8)}`,
  uri: 'spotify:track:0000000000000000000000',
  title,
  artists: ['Someone'],
  durationMs,
  albumName: 'An Album',
  albumArtUrl: null,
  explicit: false,
})

const pick = async (title: string, durationMs = 180_000) =>
  appendPick({
    roomId,
    track: track(title, durationMs),
    matchedWord: 'word',
    matchedOn: 'title',
    via: 'exact',
    seatId,
    isSeed: false,
    wasOverride: false,
    queuedToSpotify: true,
    clientNonce: `nonce-${title}-${String(Math.random()).slice(2, 10)}`,
  })

beforeEach(async () => {
  const { room } = await makeRoom()
  roomId = room.id
  seatId = (await joinRoom(roomId, 'A')).seat.id
  await startTurnAtFirstSeat(roomId)
})

afterEach(async () => {
  await dropRoom(roomId)
  await closePool()
})

describe('markPlayed', () => {
  it('stamps the given entries and shrinks the runway by their duration', async () => {
    const a = await pick('One', 200_000)
    await pick('Two', 100_000)

    expect(await runway(roomId)).toEqual({ ms: 300_000, songs: 2 })

    const result = await markPlayed(roomId, [a.entry.id])

    expect(result.markedIds).toEqual([a.entry.id])
    expect(result.runway).toEqual({ ms: 100_000, songs: 1 })
  })

  it('returns the runway it just wrote, not a stale read', async () => {
    const a = await pick('One', 200_000)
    await pick('Two', 100_000)

    const result = await markPlayed(roomId, [a.entry.id])

    // The value in the result must equal a fresh read, because it is what the
    // server broadcasts to every phone in the car.
    expect(result.runway).toEqual(await runway(roomId))
  })

  it('is idempotent, so a retried poll cannot double-stamp', async () => {
    const a = await pick('One', 200_000)
    await pick('Two', 100_000)

    const first = await markPlayed(roomId, [a.entry.id])
    const second = await markPlayed(roomId, [a.entry.id])

    expect(first.markedIds).toEqual([a.entry.id])
    // Already played, so the second pass reports nothing newly marked -- which
    // is what stops it broadcasting a second time.
    expect(second.markedIds).toEqual([])
    expect(second.runway).toEqual({ ms: 100_000, songs: 1 })
  })

  it('does not change the stamp on an entry that was already played', async () => {
    const a = await pick('One')

    await markPlayed(roomId, [a.entry.id])
    const firstStamp = (await listChain(roomId))[0]?.playedAt

    await markPlayed(roomId, [a.entry.id])
    const secondStamp = (await listChain(roomId))[0]?.playedAt

    expect(firstStamp).not.toBeNull()
    expect(secondStamp).toBe(firstStamp)
  })

  it('takes an empty list without touching anything', async () => {
    await pick('One', 200_000)

    const result = await markPlayed(roomId, [])

    expect(result.markedIds).toEqual([])
    expect(result.runway).toEqual({ ms: 200_000, songs: 1 })
  })

  it('ignores ids belonging to another room', async () => {
    const mine = await pick('One', 200_000)
    const other = await makeRoom()
    try {
      const result = await markPlayed(other.room.id, [mine.entry.id])

      expect(result.markedIds).toEqual([])
      // Still unplayed in its own room.
      expect(await runway(roomId)).toEqual({ ms: 200_000, songs: 1 })
    } finally {
      await dropRoom(other.room.id)
    }
  })
})

describe('playbackEntries with resolvePlayback', () => {
  it('advances the chain from what Spotify reports, end to end', async () => {
    const a = await pick('One', 200_000)
    const b = await pick('Two', 100_000)
    const c = await pick('Three', 150_000)

    // Spotify says the third song is playing, so the first two are behind us.
    const entries = await playbackEntries(roomId)
    const resolution = resolvePlayback(entries, {
      nowPlayingTrackId: c.entry.track.id,
      queuedTrackIds: null,
    })

    expect(resolution.playedEntryIds).toEqual([a.entry.id, b.entry.id])
    expect(resolution.nowPlayingEntryId).toBe(c.entry.id)

    const { runway: after } = await markPlayed(roomId, resolution.playedEntryIds)

    // Only the currently playing song is left in the runway.
    expect(after).toEqual({ ms: 150_000, songs: 1 })
  })

  it('returns entries in chain order, which the decision depends on', async () => {
    const a = await pick('One')
    const b = await pick('Two')
    const c = await pick('Three')

    const entries = await playbackEntries(roomId)

    expect(entries.map((entry) => entry.id)).toEqual([a.entry.id, b.entry.id, c.entry.id])
  })

  it('reports played entries so a second pass does not re-mark them', async () => {
    const a = await pick('One')
    await pick('Two')

    await markPlayed(roomId, [a.entry.id])
    const entries = await playbackEntries(roomId)

    expect(entries[0]?.playedAt).not.toBeNull()
    expect(entries[1]?.playedAt).toBeNull()
  })
})
