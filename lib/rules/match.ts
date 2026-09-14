import { keysOf, keysOfWord, sharedKey } from './forms/keys'
import { isStopword } from './forms/stopwords'
import {
  normalizeArtistName,
  normalizeTitle,
  tokenizeArtists,
  tokenizeTitle,
} from './normalize/tokenize'
import type { ChainEntry, MatchedOn, RuleSettings, Token, Track, Via } from './types'

export type BlockedBy = 'stopword' | 'word-reuse'

/** One word the two songs have in common, and whether it can be the link. */
export type SharedWord = {
  /** The word as it appears in the candidate, for display and highlighting. */
  word: string
  norm: string
  /** The key the two words met on: identical for `exact`, a form for `loose`. */
  key: string
  matchedOn: MatchedOn
  via: Via
  accepted: boolean
  why: string
  blockedBy?: BlockedBy
  candidateToken: Token
  previousToken: Token
}

export type DuplicateInfo = {
  kind: 'track-id' | 'title-artist'
  /** 1-based position in the chain. */
  turn: number
  track: Track
}

export type CooldownInfo = {
  artist: string
  turn: number
  picksAgo: number
}

export type Analysis = {
  duplicate: DuplicateInfo | null
  cooldown: CooldownInfo | null
  /** Every shared word, blocked ones included, best candidate first. */
  shared: SharedWord[]
  /** The first usable link, or null if there is none. */
  best: SharedWord | null
  /** The chain `analyze` actually reasoned over, with `prev` guaranteed last. */
  chain: ChainEntry[]
}

/**
 * `prev` is authoritative for word matching and `history` for reuse, cooldown
 * and duplicates. Normally `history` already ends with `prev`; if a caller
 * passes them separately we append it, so both call styles behave.
 */
function effectiveChain(prev: Track, history: readonly ChainEntry[]): ChainEntry[] {
  const last = history[history.length - 1]
  if (last !== undefined && last.track.id === prev.id) return [...history]
  return [...history, { track: prev, matchedWord: null, matchedOn: null, via: null }]
}

function songKey(track: Track): string {
  return `${normalizeTitle(track.title)}|${normalizeArtistName(track.artists[0] ?? '')}`
}

/**
 * The same track twice is always blocked, and so is the same song under a
 * different Spotify id -- the remaster of something already played matches on
 * normalized title plus primary artist. Duration is deliberately ignored:
 * remasters drift by a second or two.
 */
function findDuplicate(candidate: Track, chain: readonly ChainEntry[]): DuplicateInfo | null {
  const candidateKey = songKey(candidate)
  const comparable = normalizeTitle(candidate.title).length > 0
  for (let i = 0; i < chain.length; i += 1) {
    const entry = chain[i] as ChainEntry
    if (entry.track.id === candidate.id) {
      return { kind: 'track-id', turn: i + 1, track: entry.track }
    }
    if (comparable && songKey(entry.track) === candidateKey) {
      return { kind: 'title-artist', turn: i + 1, track: entry.track }
    }
  }
  return null
}

/**
 * Blocks another song by an artist used in the last N picks, which is what
 * stops a chain from becoming Yellow Days, Yellow Days, Yellow Days. Featured
 * artists count: they are in `artists` and the rule is about who you just heard.
 */
function findCooldown(
  candidate: Track,
  chain: readonly ChainEntry[],
  settings: RuleSettings,
): CooldownInfo | null {
  if (settings.artistCooldown <= 0) return null
  const candidateArtists = new Set(
    candidate.artists.map(normalizeArtistName).filter((name) => name.length > 0),
  )
  if (candidateArtists.size === 0) return null

  const windowStart = Math.max(0, chain.length - settings.artistCooldown)
  for (let i = chain.length - 1; i >= windowStart; i -= 1) {
    const entry = chain[i] as ChainEntry
    for (const artist of entry.track.artists) {
      if (candidateArtists.has(normalizeArtistName(artist))) {
        return { artist, turn: i + 1, picksAgo: chain.length - i }
      }
    }
  }
  return null
}

type BurnedWord = { word: string; turn: number }

/**
 * Keys that can no longer be the link, mapped back to the turn that spent
 * them. Comparison is by key set, not by spelling, so `drivin` and `driving`
 * burn together.
 *
 * `burnOnce` spends only words that actually *were* the link; the other words
 * of a played title stay live, or a chain of any length would strangle itself.
 */
function burnedKeys(
  chain: readonly ChainEntry[],
  settings: RuleSettings,
): Map<string, BurnedWord> {
  const burned = new Map<string, BurnedWord>()
  if (settings.wordReuse === 'free') return burned

  const indexed = chain.map((entry, index) => [entry, index] as const)
  const window = settings.wordReuse === 'noConsecutive' ? indexed.slice(-1) : indexed

  for (const [entry, index] of window) {
    const word = entry.matchedWord
    if (word === null) continue
    for (const key of keysOfWord(word, settings)) {
      if (!burned.has(key)) burned.set(key, { word, turn: index + 1 })
    }
  }
  return burned
}

function collectTokens(track: Track, settings: RuleSettings): Token[] {
  const tokens = tokenizeTitle(track.title)
  if (settings.matchScope === 'titleAndArtist') {
    tokens.push(...tokenizeArtists(track.artists))
  }
  return tokens
}

/** Lower sorts first: exact before loose, title before artist, then position. */
type Rank = readonly [number, number, number, number]

function compareRank(a: Rank, b: Rank): number {
  for (let i = 0; i < a.length; i += 1) {
    const diff = (a[i] as number) - (b[i] as number)
    if (diff !== 0) return diff
  }
  return 0
}

function describeAccepted(candidateToken: Token, previousToken: Token, via: Via): string {
  const where = previousToken.field === 'title' ? 'the previous title' : "the previous song's artist"
  const mine = candidateToken.field === 'artist' ? " (from this song's artist)" : ''
  if (via === 'exact') {
    return `"${previousToken.raw}" is in ${where}${mine}`
  }
  return `"${candidateToken.raw}" matches "${previousToken.raw}" in ${where}${mine}`
}

function describeBurned(word: string, burned: BurnedWord, settings: RuleSettings): string {
  if (settings.wordReuse === 'noConsecutive') {
    return `"${word}" was the link last turn, and this room blocks the same word twice in a row`
  }
  return `"${word}" was already spent as the link on turn ${burned.turn}`
}

/**
 * The single code path behind `validate` and `explain`.
 *
 * Sharing one analysis is what keeps the two honest: the reason shown in the
 * UI is derived from the same evidence that rejected the pick, so a player
 * cannot be told one thing and scored by another.
 */
export function analyze(
  prev: Track,
  candidate: Track,
  history: readonly ChainEntry[],
  settings: RuleSettings,
): Analysis {
  const chain = effectiveChain(prev, history)
  const duplicate = findDuplicate(candidate, chain)
  const cooldown = findCooldown(candidate, chain, settings)
  const burned = burnedKeys(chain, settings)

  const candidateTokens = collectTokens(candidate, settings)
  const previousTokens = collectTokens(prev, settings)
  const previousKeys = previousTokens.map((token) => keysOf(token, settings))

  const bestByWord = new Map<string, { shared: SharedWord; rank: Rank }>()

  candidateTokens.forEach((candidateToken, candidateIndex) => {
    const candidateKeys = keysOf(candidateToken, settings)
    previousTokens.forEach((previousToken, previousIndex) => {
      const key = sharedKey(candidateKeys, previousKeys[previousIndex] as Set<string>)
      if (key === null) return

      const via: Via = candidateToken.norm === previousToken.norm ? 'exact' : 'loose'
      const matchedOn: MatchedOn =
        candidateToken.field === 'title' && previousToken.field === 'title' ? 'title' : 'artist'
      const rank: Rank = [
        via === 'exact' ? 0 : 1,
        matchedOn === 'title' ? 0 : 1,
        candidateIndex,
        previousIndex,
      ]

      const existing = bestByWord.get(candidateToken.norm)
      if (existing !== undefined && compareRank(existing.rank, rank) <= 0) return

      const base = {
        word: candidateToken.raw,
        norm: candidateToken.norm,
        key,
        matchedOn,
        via,
        candidateToken,
        previousToken,
      }

      let shared: SharedWord
      if (settings.stopwords === 'ignore' && isStopword(candidateToken.norm)) {
        shared = {
          ...base,
          accepted: false,
          blockedBy: 'stopword',
          why: `"${candidateToken.raw}" is a stopword, and this room ignores them`,
        }
      } else {
        const burnedHit = findBurned(candidateKeys, burned)
        shared =
          burnedHit === null
            ? { ...base, accepted: true, why: describeAccepted(candidateToken, previousToken, via) }
            : {
                ...base,
                accepted: false,
                blockedBy: 'word-reuse',
                why: describeBurned(candidateToken.raw, burnedHit, settings),
              }
      }

      bestByWord.set(candidateToken.norm, { shared, rank })
    })
  })

  const ranked = [...bestByWord.values()].sort((a, b) => compareRank(a.rank, b.rank))
  const shared = ranked.map((entry) => entry.shared)

  return {
    duplicate,
    cooldown,
    shared,
    best: shared.find((word) => word.accepted) ?? null,
    chain,
  }
}

function findBurned(
  keys: ReadonlySet<string>,
  burned: ReadonlyMap<string, BurnedWord>,
): BurnedWord | null {
  for (const key of keys) {
    const hit = burned.get(key)
    if (hit !== undefined) return hit
  }
  return null
}
