import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../settings'
import { normalizeWord, tokenizeTitle } from '../normalize/tokenize'
import type { RuleSettings } from '../types'
import { intersects, keysOf, keysOfWord, sharedKey } from './keys'
import { gDropRestore } from './gdrop'
import { numeralWord } from './numerals'
import { isStopword } from './stopwords'

const settings = (over: Partial<RuleSettings> = {}): RuleSettings => ({
  ...DEFAULT_SETTINGS,
  ...over,
  allowRepeatSongs: false,
})

/** Would these two words link, under these settings? */
const links = (a: string, b: string, over: Partial<RuleSettings> = {}): boolean => {
  const s = settings(over)
  const ta = normalizeWord(a)
  const tb = normalizeWord(b)
  if (ta === null || tb === null) return false
  return intersects(keysOf(ta, s), keysOf(tb, s))
}

describe('looseForms: g-drop restoration', () => {
  it('links the forms the game needs', () => {
    expect(links("drivin'", 'driving')).toBe(true)
    expect(links("lovin'", 'loving')).toBe(true)
    expect(links('drivin', 'driving')).toBe(true)
    expect(links('lovin', 'love')).toBe(true)
    expect(links("rollin'", 'rolling')).toBe(true)
    expect(links('runnin', 'running')).toBe(true)
    expect(links('gettin', 'getting')).toBe(true)
    expect(links('nothin', 'nothing')).toBe(true)
    expect(links('waitin', 'waiting')).toBe(true)
  })

  it('does not invent links from real -in words', () => {
    // The whole reason g-drop is gated. Each of these would link if the rule
    // were a blind "-in" -> "-ing" rewrite.
    expect(links('sin', 'sing')).toBe(false)
    expect(links('thin', 'thing')).toBe(false)
    expect(links('win', 'wing')).toBe(false)
    expect(links('satin', 'sating')).toBe(false)
    expect(links('basin', 'basing')).toBe(false)
    expect(links('ruin', 'ruing')).toBe(false)
    expect(links('robin', 'robing')).toBe(false)
    expect(links('raisin', 'raising')).toBe(false)
    expect(links('aspirin', 'aspiring')).toBe(false)
  })

  it('still links real -in words through plain stemming', () => {
    // "rain" is denied a g-drop, but Porter maps "raining" onto it anyway.
    expect(links('rain', 'raining')).toBe(true)
    expect(links('train', 'trains')).toBe(true)
    expect(links('skin', 'skins')).toBe(true)
  })

  it('honours a trailing apostrophe over the denylist', () => {
    expect(gDropRestore('thin', false)).toBeNull()
    expect(gDropRestore('thin', true)).toBe('thing')
  })

  it('leaves short and non -in words alone', () => {
    // Fewer than two letters before the -in: every one of these is a real
    // word whose restored form is also real.
    expect(gDropRestore('in', false)).toBeNull()
    expect(gDropRestore('sin', false)).toBeNull()
    expect(gDropRestore('sin', true)).toBeNull()
    expect(gDropRestore('gin', false)).toBeNull()
    expect(gDropRestore('road', false)).toBeNull()
  })
})

describe('looseForms: stemming', () => {
  it('links inflections', () => {
    expect(links('run', 'running')).toBe(true)
    expect(links('run', 'runs')).toBe(true)
    expect(links('running', 'runs')).toBe(true)
    expect(links('love', 'loving')).toBe(true)
    expect(links('cry', 'cries')).toBe(true)
    expect(links('happy', 'happiness')).toBe(true)
    expect(links('dance', 'dancing')).toBe(true)
  })

  it('does not link unrelated words that merely rhyme', () => {
    expect(links('road', 'road trip')).toBe(true) // first token only
    expect(links('yellow', 'mellow')).toBe(false)
    expect(links('brick', 'break')).toBe(false)
    expect(links('submarine', 'submerge')).toBe(false)
  })

  it('links monosyllable y-plurals, which Porter alone misses', () => {
    expect(links('cry', 'cries')).toBe(true)
    expect(links('try', 'tries')).toBe(true)
    expect(links('fly', 'flies')).toBe(true)
    // Porter already handles the polysyllables.
    expect(links('story', 'stories')).toBe(true)
    // Accepted collision from the same rule: "sky" reaches "ski".
    expect(links('sky', 'ski')).toBe(true)
  })

  it('pins known Porter over-stems, rather than pretending they do not happen', () => {
    // Porter collapses these to "univers" / "organ". Accepted as loose links;
    // `looseForms: 'off'` is the escape hatch, and explain() names the word.
    expect(links('universe', 'universal')).toBe(true)
    expect(links('organ', 'organization')).toBe(true)
    expect(links('universe', 'universal', { looseForms: 'off' })).toBe(false)
  })

  it('is off when looseForms is off', () => {
    expect(links('run', 'running', { looseForms: 'off' })).toBe(false)
    expect(links("drivin'", 'driving', { looseForms: 'off' })).toBe(false)
    expect(links('run', 'run', { looseForms: 'off' })).toBe(true)
  })
})

describe('numerals', () => {
  it('is strict by default', () => {
    expect(links('4', 'four')).toBe(false)
    expect(links('2', 'two')).toBe(false)
  })

  it('links digits to words when loose', () => {
    expect(links('4', 'four', { numerals: 'loose' })).toBe(true)
    expect(links('2', 'two', { numerals: 'loose' })).toBe(true)
    expect(links('20', 'twenty', { numerals: 'loose' })).toBe(true)
    expect(links('1000', 'thousand', { numerals: 'loose' })).toBe(true)
  })

  it('does not link different numbers', () => {
    expect(links('4', 'five', { numerals: 'loose' })).toBe(false)
    expect(links('7', '8', { numerals: 'loose' })).toBe(false)
  })

  it('maps only single-token numbers', () => {
    expect(numeralWord('99')).toBeNull()
    expect(numeralWord('four')).toBe('four')
    expect(numeralWord('4')).toBe('four')
    expect(numeralWord('road')).toBeNull()
  })
})

describe('stopwords', () => {
  it('knows the house list', () => {
    expect(isStopword('the')).toBe(true)
    expect(isStopword('of')).toBe(true)
    expect(isStopword('yellow')).toBe(false)
  })
})

describe('key sets', () => {
  it('prefers the literal form as the shared key', () => {
    const s = settings()
    const a = tokenizeTitle('Running')[0]
    const b = tokenizeTitle('Running')[0]
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    expect(sharedKey(keysOf(a!, s), keysOf(b!, s))).toBe('running')
  })

  it('returns null when nothing is shared', () => {
    const s = settings()
    const a = tokenizeTitle('Yellow')[0]
    const b = tokenizeTitle('Submarine')[0]
    expect(sharedKey(keysOf(a!, s), keysOf(b!, s))).toBeNull()
  })

  it('keys a stored word the same way as a token', () => {
    const s = settings()
    expect(keysOfWord("Drivin'", s).has('drive')).toBe(true)
    expect(keysOfWord('   ', s).size).toBe(0)
  })

  it('does not add a stem shorter than three characters', () => {
    const s = settings()
    const token = normalizeWord('us')
    expect([...keysOf(token!, s)]).toEqual(['us'])
  })
})
