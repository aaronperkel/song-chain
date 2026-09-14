import { stemmer } from 'stemmer'
import type { RuleSettings, Token } from '../types'
import { normalizeWord } from '../normalize/tokenize'
import { gDropRestore } from './gdrop'
import { yVariant } from './inflect'
import { numeralWord } from './numerals'

/**
 * Stems shorter than this collide too easily to be trusted as a link.
 */
const MIN_STEM_LENGTH = 3

/**
 * Every form a word may match through.
 *
 * A *set* of keys rather than one canonical string is what keeps `looseForms`
 * honest. Collapsing each word to a single canonical form forces a choice
 * between missing `drivin ~ driving` and inventing `sin ~ sing`; comparing key
 * sets lets a token carry its speculative forms without those forms
 * overwriting its literal one. Two words match when their key sets intersect.
 */
export function keysOf(token: Token, settings: RuleSettings): Set<string> {
  const keys = new Set<string>([token.norm])

  if (settings.numerals === 'loose') {
    const word = numeralWord(token.norm)
    if (word !== null) keys.add(word)
  }

  if (settings.looseForms === 'on') {
    addStem(keys, token.norm)
    const restored = gDropRestore(token.norm, token.elided)
    if (restored !== null) {
      keys.add(restored)
      addStem(keys, restored)
    }
    const yForm = yVariant(token.norm)
    if (yForm !== null) keys.add(yForm)
  }

  return keys
}

function addStem(keys: Set<string>, norm: string): void {
  const stem = stemmer(norm)
  if (stem.length >= MIN_STEM_LENGTH) keys.add(stem)
}

/** Key set for a bare stored word, e.g. a previous turn's `matchedWord`. */
export function keysOfWord(word: string, settings: RuleSettings): Set<string> {
  const token = normalizeWord(word)
  return token === null ? new Set<string>() : keysOf(token, settings)
}

/** The shared key two tokens match on, preferring the literal form. */
export function sharedKey(a: ReadonlySet<string>, b: ReadonlySet<string>): string | null {
  for (const key of a) {
    if (b.has(key)) return key
  }
  return null
}

export function intersects(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return sharedKey(a, b) !== null
}
