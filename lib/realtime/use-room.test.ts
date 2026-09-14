import { describe, expect, it } from 'vitest'
import type { RoomState } from '@/lib/api/room-state'
import type { StoredEntry } from '@/lib/rooms/entry'
import { DEFAULT_SETTINGS } from '@/lib/rules'
import { apply } from './use-room'

const entry = (id: string, position: number): StoredEntry => ({
  id,
  position,
  track: {
    id: `t${id}`,
    uri: 'spotify:track:x',
    title: `Song ${id}`,
    artists: ['Someone'],
    durationMs: 200_000,
    albumName: null,
    albumArtUrl: null,
    explicit: false,
  },
  matchedWord: 'word',
  matchedOn: 'title',
  via: 'exact',
  seatId: 'seat-1',
  seatName: 'A',
  isSeed: false,
  wasOverride: false,
  queuedToSpotify: false,
  playedAt: null,
  createdAt: '2026-09-14T12:00:00.000Z',
})

const baseState = (over: Partial<RoomState> = {}): RoomState => ({
  room: {
    id: 'room-1',
    code: 'ABCDE',
    status: 'playing',
    mode: 'live',
    settings: DEFAULT_SETTINGS,
    hostConnected: true,
    hostDisplayName: 'Aaron',
  },
  seats: [],
  chain: [],
  turn: { currentSeatId: 'seat-1', turnStartedAt: null },
  runway: { ms: 0, songs: 0 },
  you: { seatId: 'seat-2', isHost: false, isYourTurn: false },
  ...over,
})

describe('applying room events', () => {
  it('appends a pick and updates the turn and runway', () => {
    const next = apply(baseState(), {
      type: 'pick',
      entry: entry('a', 0),
      turn: { currentSeatId: 'seat-2', turnStartedAt: '2026-09-14T12:00:00.000Z' },
      runway: { ms: 200_000, songs: 1 },
    })

    expect(next.chain.map((e) => e.id)).toEqual(['a'])
    expect(next.turn.currentSeatId).toBe('seat-2')
    expect(next.runway.songs).toBe(1)
    expect(next.you.isYourTurn).toBe(true)
  })

  it('is safe to apply the same pick twice', () => {
    // The submitting device applies its own pick from the response, then the
    // broadcast for it arrives; a reconnecting phone can see it twice too.
    const once = apply(baseState(), {
      type: 'pick',
      entry: entry('a', 0),
      turn: { currentSeatId: 'seat-1', turnStartedAt: null },
      runway: { ms: 200_000, songs: 1 },
    })
    const twice = apply(once, {
      type: 'pick',
      entry: entry('a', 0),
      turn: { currentSeatId: 'seat-1', turnStartedAt: null },
      runway: { ms: 200_000, songs: 1 },
    })

    expect(twice.chain).toHaveLength(1)
  })

  it('keeps the chain in position order when events arrive late', () => {
    const state = apply(baseState({ chain: [entry('b', 1)] }), {
      type: 'pick',
      entry: entry('a', 0),
      turn: { currentSeatId: 'seat-1', turnStartedAt: null },
      runway: { ms: 0, songs: 0 },
    })
    expect(state.chain.map((e) => e.position)).toEqual([0, 1])
  })

  it('removes an undone entry', () => {
    const state = apply(baseState({ chain: [entry('a', 0), entry('b', 1)] }), {
      type: 'undo',
      removedEntryId: 'b',
      turn: { currentSeatId: 'seat-1', turnStartedAt: null },
      runway: { ms: 0, songs: 0 },
    })
    expect(state.chain.map((e) => e.id)).toEqual(['a'])
  })

  it('recomputes whether it is your turn on a seats change', () => {
    const state = apply(baseState(), {
      type: 'seats',
      seats: [],
      turn: { currentSeatId: 'seat-2', turnStartedAt: null },
    })
    expect(state.you.isYourTurn).toBe(true)
  })

  it('never claims it is your turn when you have no seat', () => {
    const state = apply(baseState({ you: { seatId: null, isHost: true, isYourTurn: false } }), {
      type: 'turn',
      turn: { currentSeatId: null, turnStartedAt: null },
    })
    expect(state.you.isYourTurn).toBe(false)
  })

  it('marks entries played without overwriting an existing timestamp', () => {
    const played = { ...entry('a', 0), playedAt: '2026-09-14T11:00:00.000Z' }
    const state = apply(baseState({ chain: [played, entry('b', 1)] }), {
      type: 'playback',
      playedEntryIds: ['a', 'b'],
      runway: { ms: 0, songs: 0 },
      nowPlayingId: 'b',
    })
    expect(state.chain[0]?.playedAt).toBe('2026-09-14T11:00:00.000Z')
    expect(state.chain[1]?.playedAt).not.toBeNull()
  })

  it('updates room status and mode', () => {
    const state = apply(baseState(), { type: 'room', status: 'paused', mode: 'manual' })
    expect(state.room.status).toBe('paused')
    expect(state.room.mode).toBe('manual')
  })
})
