import { analyze } from './match'
import { DEFAULT_SETTINGS } from './settings'
import type { ChainEntry, MatchResult, RuleSettings, Track } from './types'

/**
 * Is this pick a legal next link in the chain?
 *
 * The server is authoritative: this runs again on submit, whatever the client
 * decided. Rejection reasons are ordered most-specific first, so a player is
 * told the one thing that actually blocked them:
 *
 * 1. `duplicate-song`    -- the song is already in the chain
 * 2. `artist-cooldown`   -- blocks regardless of words, so it outranks them
 * 3. `no-shared-word`    -- nothing in common at all
 * 4. `stopword-only`     -- the only thing in common was "the"
 * 5. `word-already-used` -- a real word, but it has been spent
 */
export function validate(
  prev: Track,
  candidate: Track,
  history: readonly ChainEntry[],
  settings: RuleSettings = DEFAULT_SETTINGS,
): MatchResult {
  const analysis = analyze(prev, candidate, history, settings)

  if (analysis.duplicate !== null) return { valid: false, reason: 'duplicate-song' }
  if (analysis.cooldown !== null) return { valid: false, reason: 'artist-cooldown' }
  if (analysis.shared.length === 0) return { valid: false, reason: 'no-shared-word' }

  const best = analysis.best
  if (best !== null) {
    return { valid: true, matchedWord: best.word, matchedOn: best.matchedOn, via: best.via }
  }

  const hadRealWord = analysis.shared.some((word) => word.blockedBy !== 'stopword')
  return { valid: false, reason: hadRealWord ? 'word-already-used' : 'stopword-only' }
}
