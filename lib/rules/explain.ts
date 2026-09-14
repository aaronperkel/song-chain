import { analyze } from './match'
import { DEFAULT_SETTINGS } from './settings'
import type { ChainEntry, MatchedOn, RuleSettings, Track, Via } from './types'

export type SharedWordExplanation = {
  word: string
  accepted: boolean
  why: string
  /** Where the link would land. Absent only if the word is unusable. */
  matchedOn?: MatchedOn
  via?: Via
  /** `[start, end)` in the candidate's title or artist, for highlighting. */
  range?: readonly [number, number]
  field?: 'title' | 'artist'
}

/**
 * A reason the pick is rejected that has nothing to do with words, and so
 * cannot be expressed as a shared word.
 */
export type Blocker = {
  kind: 'duplicate-song' | 'artist-cooldown'
  why: string
}

export type Explanation = {
  /**
   * Every word the two songs share. `accepted` is a statement about the
   * *word*: a word can be a perfectly good link while the pick is still
   * rejected by a `blocker`, and the UI should show blockers first.
   */
  sharedWords: SharedWordExplanation[]
  blockers?: Blocker[]
}

/**
 * Why a pick was accepted or rejected, in words a player can read.
 *
 * This exists so nobody argues about a rejection in the car, which means it
 * has to account for every rejection `validate` can return -- including the
 * two that are not about words at all.
 */
export function explain(
  prev: Track,
  candidate: Track,
  history: readonly ChainEntry[],
  settings: RuleSettings = DEFAULT_SETTINGS,
): Explanation {
  const analysis = analyze(prev, candidate, history, settings)

  const sharedWords: SharedWordExplanation[] = analysis.shared.map((word) => ({
    word: word.word,
    accepted: word.accepted,
    why: word.why,
    matchedOn: word.matchedOn,
    via: word.via,
    range: [word.candidateToken.start, word.candidateToken.end] as const,
    field: word.candidateToken.field,
  }))

  const blockers: Blocker[] = []

  if (analysis.duplicate !== null) {
    const { kind, turn, track } = analysis.duplicate
    blockers.push({
      kind: 'duplicate-song',
      why:
        kind === 'track-id'
          ? `"${track.title}" is already in the chain, from turn ${turn}`
          : `"${track.title}" is already in the chain from turn ${turn} -- same song, different release`,
    })
  }

  if (analysis.cooldown !== null) {
    const { artist, picksAgo } = analysis.cooldown
    const turns = picksAgo === 1 ? 'turn' : 'turns'
    blockers.push({
      kind: 'artist-cooldown',
      why: `${artist} was picked ${picksAgo} ${turns} ago, and this room blocks the same artist within ${settings.artistCooldown}`,
    })
  }

  return blockers.length > 0 ? { sharedWords, blockers } : { sharedWords }
}
