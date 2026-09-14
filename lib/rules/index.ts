/**
 * The rules engine: pure functions, no Spotify and no database.
 *
 * `validate` decides whether a pick is legal; `explain` says why in language
 * a player can read. Both derive from one `analyze` pass, so the explanation
 * always matches the verdict.
 */
export { validate } from './validate'
export { explain } from './explain'
export { analyze } from './match'
export { DEFAULT_SETTINGS, withDefaults } from './settings'

export {
  normalizeTitle,
  normalizeArtistName,
  normalizeWord,
  tokenizeTitle,
  tokenizeArtist,
  tokenizeArtists,
} from './normalize/tokenize'
export { stripJunkRanges, DEFAULT_NORMALIZE_OPTIONS } from './normalize/strip'
export { JUNK_PAREN, JUNK_SEGMENT, matchJunk } from './normalize/junk'
export { keysOf, keysOfWord } from './forms/keys'
export { STOPWORDS, isStopword } from './forms/stopwords'

export type {
  ChainEntry,
  MatchResult,
  MatchScope,
  MatchedOn,
  RejectReason,
  RuleSettings,
  Token,
  TokenField,
  Track,
  Via,
  WordReuseMode,
} from './types'
export type { Analysis, CooldownInfo, DuplicateInfo, SharedWord } from './match'
export type { Blocker, Explanation, SharedWordExplanation } from './explain'
export type { NormalizeOptions, Range, StrippedRange } from './normalize/strip'
export type { JunkRule } from './normalize/junk'
