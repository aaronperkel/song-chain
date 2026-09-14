/**
 * Core types for the rules engine.
 *
 * Everything in `lib/rules` is pure: no Spotify imports, no database imports,
 * no I/O. `Track` is a structural subset of a Spotify track, mapped at the
 * boundary in `lib/spotify`, so the engine never depends on their API shape.
 */

export type Track = {
  id: string
  title: string
  artists: string[]
  durationMs: number
}

/** Which field supplied the linking word. */
export type MatchedOn = 'title' | 'artist'

/** Whether the words were identical or matched through a loose form. */
export type Via = 'exact' | 'loose'

/**
 * One song in the chain. The seed song carries nulls: nothing preceded it,
 * so no word linked it in.
 */
export type ChainEntry = {
  track: Track
  matchedWord: string | null
  matchedOn: MatchedOn | null
  via: Via | null
}

export type RejectReason =
  | 'no-shared-word'
  | 'stopword-only'
  | 'word-already-used'
  | 'artist-cooldown'
  | 'duplicate-song'

export type MatchResult =
  | { valid: true; matchedWord: string; matchedOn: MatchedOn; via: Via }
  | { valid: false; reason: RejectReason }

export type MatchScope = 'title' | 'titleAndArtist'
export type StopwordMode = 'ignore' | 'allow'
export type LooseFormsMode = 'on' | 'off'
export type NumeralsMode = 'strict' | 'loose'
export type WordReuseMode = 'free' | 'noConsecutive' | 'burnOnce'

export type RuleSettings = {
  /** Whether artist-name words can form a link. */
  matchScope: MatchScope
  /** Can't pick another song by an artist used in the last N picks. 0 = off. */
  artistCooldown: number
  /** Whether stopwords ("the", "of", ...) can form a link. */
  stopwords: StopwordMode
  /** drivin ~ driving, run ~ running ~ runs. */
  looseForms: LooseFormsMode
  /** Loose: 4 ~ four. */
  numerals: NumeralsMode
  /** How aggressively a word is spent once it has been the link. */
  wordReuse: WordReuseMode
  /** Always false for now: the same track twice in a session is blocked. */
  allowRepeatSongs: false
  /** Seconds before a turn auto-skips. 0 = off. */
  turnTimer: number
}

export type TokenField = 'title' | 'artist'

/**
 * A word from a title or artist name.
 *
 * `start`/`end` index into the *original* string, not the normalized one, so
 * the UI can highlight the matched word in the real title without re-deriving
 * anything. `elided` marks a trailing apostrophe (`drivin'`), which is the
 * strongest available signal that a word is a dropped-g gerund.
 */
export type Token = {
  norm: string
  raw: string
  start: number
  end: number
  field: TokenField
  elided: boolean
}
