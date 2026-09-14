import type { ChainEntry, RuleSettings, Track } from '../types'
import { DEFAULT_SETTINGS } from '../settings'

let counter = 0

/** A track with a generated id, so duplicate detection is opt-in per test. */
export function track(title: string, artists: string | string[] = 'Test Artist', durationMs = 210_000): Track {
  counter += 1
  return {
    id: `t${counter}`,
    title,
    artists: typeof artists === 'string' ? [artists] : artists,
    durationMs,
  }
}

export function withId(id: string, t: Track): Track {
  return { ...t, id }
}

/** A chain entry. `matchedWord` is what `wordReuse` spends. */
export function entry(t: Track, matchedWord: string | null = null): ChainEntry {
  return {
    track: t,
    matchedWord,
    matchedOn: matchedWord === null ? null : 'title',
    via: matchedWord === null ? null : 'exact',
  }
}

export function settings(over: Partial<RuleSettings> = {}): RuleSettings {
  return { ...DEFAULT_SETTINGS, ...over, allowRepeatSongs: false }
}

/** Distinct artists by default, so artistCooldown doesn't fire unasked. */
export const YELLOW_BRICK_ROAD = track('Goodbye Yellow Brick Road', 'Elton John')
export const YELLOW_SUBMARINE = track('Yellow Submarine', 'The Beatles')
