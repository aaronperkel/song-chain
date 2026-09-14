import { describe, expect, it } from 'vitest'
import {
  resolvePlayback,
  toPlaybackReading,
  type PlaybackEntry,
} from './playback'

/**
 * The runway is the number every phone in the car is looking at, so the cost
 * of getting this wrong is asymmetric. Marking a song played too early erases
 * real music from the estimate; marking one late costs a stale number for one
 * poll. These tests pin that bias.
 */
function chain(...specs: Array<[id: string, trackId: string, played?: boolean]>): PlaybackEntry[] {
  return specs.map(([id, trackId, played = false]) => ({
    id,
    trackId,
    playedAt: played ? '2026-09-14T10:00:00.000Z' : null,
  }))
}

const reading = (
  nowPlayingTrackId: string | null,
  queuedTrackIds: string[] | null = null,
): Parameters<typeof resolvePlayback>[1] => ({ nowPlayingTrackId, queuedTrackIds })

describe('resolvePlayback', () => {
  it('marks everything before the currently playing song as played', () => {
    const entries = chain(['e1', 't1'], ['e2', 't2'], ['e3', 't3'])

    expect(resolvePlayback(entries, reading('t3'))).toEqual({
      playedEntryIds: ['e1', 'e2'],
      nowPlayingEntryId: 'e3',
    })
  })

  it('leaves the currently playing song unplayed, so it still counts as runway', () => {
    const entries = chain(['e1', 't1'], ['e2', 't2'])

    const result = resolvePlayback(entries, reading('t1'))

    expect(result.playedEntryIds).toEqual([])
    expect(result.nowPlayingEntryId).toBe('e1')
  })

  it('does not re-mark entries that are already played', () => {
    const entries = chain(['e1', 't1', true], ['e2', 't2', true], ['e3', 't3'], ['e4', 't4'])

    expect(resolvePlayback(entries, reading('t4'))).toEqual({
      playedEntryIds: ['e3'],
      nowPlayingEntryId: 'e4',
    })
  })

  it('marks nothing when the host is playing something outside the chain', () => {
    const entries = chain(['e1', 't1'], ['e2', 't2'])

    expect(resolvePlayback(entries, reading('unrelated'))).toEqual({
      playedEntryIds: [],
      nowPlayingEntryId: null,
    })
  })

  it('marks nothing when playback is idle', () => {
    const entries = chain(['e1', 't1'], ['e2', 't2'])

    expect(resolvePlayback(entries, reading(null))).toEqual({
      playedEntryIds: [],
      nowPlayingEntryId: null,
    })
  })

  it('marks nothing on an empty chain', () => {
    expect(resolvePlayback([], reading('t1'))).toEqual({
      playedEntryIds: [],
      nowPlayingEntryId: null,
    })
  })

  it('picks the earliest unplayed copy when a track repeats in the chain', () => {
    // allowRepeatSongs lets the same song appear twice. The one playing now is
    // the one we have not passed yet -- matching the first copy would rewind
    // the runway and re-queue songs that already played.
    const entries = chain(['e1', 'dup', true], ['e2', 't2'], ['e3', 'dup'], ['e4', 't4'])

    expect(resolvePlayback(entries, reading('dup'))).toEqual({
      playedEntryIds: ['e2'],
      nowPlayingEntryId: 'e3',
    })
  })

  describe('reconciling against the real Spotify queue', () => {
    it('catches a song skipped between two polls', () => {
      // t2 was skipped fast enough that no poll ever saw it playing. Spotify
      // still has t3 and t4 queued, so t1 and t2 are demonstrably behind us.
      const entries = chain(['e1', 't1'], ['e2', 't2'], ['e3', 't3'], ['e4', 't4'])

      expect(resolvePlayback(entries, reading('something-else', ['t3', 't4']))).toEqual({
        playedEntryIds: ['e1', 'e2'],
        nowPlayingEntryId: null,
      })
    })

    it('prefers the currently playing track over the queue when both locate us', () => {
      const entries = chain(['e1', 't1'], ['e2', 't2'], ['e3', 't3'])

      expect(resolvePlayback(entries, reading('t2', ['t3']))).toEqual({
        playedEntryIds: ['e1'],
        nowPlayingEntryId: 'e2',
      })
    })

    it('marks nothing when the queue holds none of the chain', () => {
      const entries = chain(['e1', 't1'], ['e2', 't2'])

      expect(resolvePlayback(entries, reading(null, ['other-a', 'other-b']))).toEqual({
        playedEntryIds: [],
        nowPlayingEntryId: null,
      })
    })

    it('marks nothing when the queue is empty, rather than assuming all played', () => {
      // An empty queue is ambiguous: the chain may have finished, or the host
      // may have just pressed play on a fresh device. Draining the whole
      // runway on that guess would be the worst possible failure.
      const entries = chain(['e1', 't1'], ['e2', 't2'])

      expect(resolvePlayback(entries, reading(null, []))).toEqual({
        playedEntryIds: [],
        nowPlayingEntryId: null,
      })
    })
  })
})

describe('toPlaybackReading', () => {
  const playing = (trackId: string | null) => ({
    trackId,
    progressMs: 1000,
    isPlaying: trackId !== null,
  })

  it('carries the currently playing track through', () => {
    expect(toPlaybackReading(playing('t1'), null)).toEqual({
      nowPlayingTrackId: 't1',
      queuedTrackIds: null,
    })
  })

  it('falls back to the queue endpoint when currently-playing is momentarily empty', () => {
    // The two endpoints disagree for a beat around a track change.
    const result = toPlaybackReading(playing(null), {
      currentTrackId: 't2',
      trackIds: ['t3'],
    })

    expect(result).toEqual({ nowPlayingTrackId: 't2', queuedTrackIds: ['t3'] })
  })

  it('distinguishes a poll that skipped the queue from one that saw it empty', () => {
    // null means "did not ask"; [] means "asked, nothing queued". Collapsing
    // the two would let a cheap poll look like an empty queue.
    expect(toPlaybackReading(playing('t1'), null).queuedTrackIds).toBeNull()
    expect(
      toPlaybackReading(playing('t1'), { currentTrackId: 't1', trackIds: [] }).queuedTrackIds,
    ).toEqual([])
  })
})
