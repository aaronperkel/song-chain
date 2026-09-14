import type { RuleSettings } from './types'

/** House rules: free-for-all word reuse, one-pick artist cooldown, no timer. */
export const DEFAULT_SETTINGS: RuleSettings = {
  matchScope: 'title',
  artistCooldown: 1,
  stopwords: 'ignore',
  looseForms: 'on',
  numerals: 'strict',
  wordReuse: 'free',
  allowRepeatSongs: false,
  turnTimer: 0,
}

/** Shallow merge over the defaults, for callers holding a partial settings row. */
export function withDefaults(partial?: Partial<RuleSettings>): RuleSettings {
  return { ...DEFAULT_SETTINGS, ...partial, allowRepeatSongs: false }
}
