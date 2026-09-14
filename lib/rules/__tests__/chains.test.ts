import { describe, expect, it } from 'vitest'
import { explain } from '../explain'
import { validate } from '../validate'
import type { ChainEntry, RuleSettings, Track } from '../types'
import { settings } from './fixtures'

/**
 * End-to-end chains, played with titles in the shape Spotify actually returns
 * them. These are the regression net for normalization: a normalizer change
 * that breaks a real chain fails here rather than in the car.
 */

let ids = 0
const t = (title: string, artist: string, durationMs = 200_000): Track => {
  ids += 1
  return { id: `chain-${ids}`, title, artists: [artist], durationMs }
}

/** Play a list of songs in order, asserting each link is accepted. */
function play(songs: readonly Track[], ruleSettings: RuleSettings): ChainEntry[] {
  const chain: ChainEntry[] = [
    { track: songs[0] as Track, matchedWord: null, matchedOn: null, via: null },
  ]
  for (let i = 1; i < songs.length; i += 1) {
    const candidate = songs[i] as Track
    const prev = songs[i - 1] as Track
    const result = validate(prev, candidate, chain, ruleSettings)
    if (!result.valid) {
      const detail = explain(prev, candidate, chain, ruleSettings)
      throw new Error(
        `"${prev.title}" -> "${candidate.title}" rejected: ${result.reason}\n` +
          `${JSON.stringify(detail, null, 2)}`,
      )
    }
    chain.push({
      track: candidate,
      matchedWord: result.matchedWord,
      matchedOn: result.matchedOn,
      via: result.via,
    })
  }
  return chain
}

describe('a full car-trip chain', () => {
  it('plays the chain from the brief', () => {
    const chain = play(
      [
        t('Goodbye Yellow Brick Road - Remastered 2014', 'Elton John'),
        t('Yellow Submarine - Remastered 2009', 'The Beatles'),
        t('Submarine Bells', 'The Chills'),
        t('Bells of Rhymney', 'The Byrds'),
        t('Rhymney River', 'Dafydd Iwan'),
        t("Take Me to the River", 'Al Green'),
      ],
      settings(),
    )
    expect(chain.map((e) => e.matchedWord)).toEqual([
      null,
      'Yellow',
      'Submarine',
      'Bells',
      'Rhymney',
      'River',
    ])
  })

  it('plays a chain that leans on loose forms', () => {
    const chain = play(
      [
        t("Drivin' My Life Away", 'Eddie Rabbitt'),
        t('Driving Home For Christmas', 'Chris Rea'),
        t('Christmas (Baby Please Come Home)', 'Darlene Love'),
        t('Please Please Me - Remastered 2009', 'The Beatles'),
        t('Me and Bobby McGee', 'Janis Joplin'),
        t('Bobby Brown Goes Down', 'Frank Zappa'),
      ],
      settings(),
    )
    expect(chain[1]?.via).toBe('loose')
    expect(chain.map((e) => e.matchedWord)).toEqual([
      null,
      'Driving',
      'Christmas',
      'Please',
      'Me',
      'Bobby',
    ])
  })

  it('plays a chain through heavy release junk', () => {
    const chain = play(
      [
        t('Bohemian Rhapsody - Remastered 2011', 'Queen'),
        t('Rhapsody in Blue (1924 Version)', 'George Gershwin'),
        t('Blue Monday - 2016 Remaster', 'New Order'),
        t('Monday Morning (Live at the Fillmore)', 'Fleetwood Mac'),
        t('Sunday Morning - Deluxe Edition', 'The Velvet Underground'),
        t('Sunday Bloody Sunday (Remastered 2008)', 'U2'),
      ],
      settings(),
    )
    expect(chain.map((e) => e.matchedWord)).toEqual([
      null,
      'Rhapsody',
      'Blue',
      'Monday',
      'Morning',
      'Sunday',
    ])
  })

  it('plays with stopwords allowed, which makes junk links legal', () => {
    const chain = play(
      [t('The Chain', 'Fleetwood Mac'), t('The Sound of Silence', 'Simon & Garfunkel')],
      settings({ stopwords: 'allow' }),
    )
    expect(chain[1]?.matchedWord).toBe('The')
  })
})

describe('a chain under stricter house rules', () => {
  const songs = [
    t('Goodbye Yellow Brick Road', 'Elton John'),
    t('Yellow Submarine', 'The Beatles'),
    t('Submarine Bells', 'The Chills'),
  ]

  it('survives burnOnce when every link is a new word', () => {
    expect(() => play(songs, settings({ wordReuse: 'burnOnce' }))).not.toThrow()
  })

  it('survives noConsecutive when every link is a new word', () => {
    expect(() => play(songs, settings({ wordReuse: 'noConsecutive' }))).not.toThrow()
  })

  it('rejects the fourth pick that reuses a burned word', () => {
    const chain = play(songs, settings({ wordReuse: 'burnOnce' }))
    // Shares only "Submarine", which was the link on turn 3.
    const reuse = t('Submarine Dreams', 'The Kinks')
    expect(
      validate(songs[2] as Track, reuse, chain, settings({ wordReuse: 'burnOnce' })),
    ).toEqual({ valid: false, reason: 'word-already-used' })
  })
})

describe('titles that must not link', () => {
  const prev = t('Goodbye Yellow Brick Road', 'Elton John')
  const rejects: ReadonlyArray<readonly [Track, string]> = [
    [t('Mellow Yellow Submarine Sandwich', 'Donovan'), 'accepted'],
    [t('Brick House', 'Commodores'), 'accepted'],
    [t('Roadhouse Blues', 'The Doors'), 'no-shared-word'],
    [t('Goodbye Stranger', 'Supertramp'), 'accepted'],
    [t('Yellowcard', 'Yellowcard'), 'no-shared-word'],
    [t('The Long and Winding Road - Remastered 2009', 'The Beatles'), 'accepted'],
  ]

  it.each(rejects)('%s', (candidate, expected) => {
    const result = validate(prev, candidate, [], settings())
    expect(result.valid ? 'accepted' : result.reason).toBe(expected)
  })

  it('does not match on a substring', () => {
    // "Yellowcard" is one word; it must not link to "Yellow".
    const result = validate(prev, t('Yellowcard', 'Yellowcard'), [], settings())
    expect(result).toEqual({ valid: false, reason: 'no-shared-word' })
  })

  it('does not link through stripped junk', () => {
    // "Remastered" appears in both titles, but only as junk.
    const a = t('Africa - 2020 Remaster', 'Toto')
    const b = t('Sledgehammer - 2012 Remaster', 'Peter Gabriel')
    expect(validate(a, b, [], settings())).toEqual({ valid: false, reason: 'no-shared-word' })
  })

  it('does not link through a stripped feature credit', () => {
    const a = t('Stay (feat. Justin Bieber)', 'The Kid LAROI')
    const b = t('Justin (feat. Somebody)', 'Nobody')
    expect(validate(a, b, [], settings())).toEqual({ valid: false, reason: 'no-shared-word' })
  })
})
