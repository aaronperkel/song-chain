import { describe, expect, it } from 'vitest'
import { explain } from '../explain'
import { validate } from '../validate'
import { entry, settings, track, withId } from './fixtures'

describe('explain surfaces every shared word', () => {
  it('names the accepted link', () => {
    const prev = track('Goodbye Yellow Brick Road', 'Elton John')
    const next = track('Yellow Submarine', 'The Beatles')
    const result = explain(prev, next, [entry(prev)], settings())
    expect(result.sharedWords).toHaveLength(1)
    expect(result.sharedWords[0]).toMatchObject({
      word: 'Yellow',
      accepted: true,
      matchedOn: 'title',
      via: 'exact',
    })
    expect(result.sharedWords[0]?.why).toBe('"Yellow" is in the previous title')
    expect(result.blockers).toBeUndefined()
  })

  it('lists every shared word in title order with its verdict', () => {
    // Reading order, not verdict order: the UI can show the whole overlap
    // next to the title, and validate() is what names the chosen link.
    const prev = track('The Sound of Silence', 'Simon & Garfunkel')
    const next = track('The Sound of Music', 'Rodgers & Hammerstein')
    const result = explain(prev, next, [entry(prev)], settings())
    expect(result.sharedWords.map((w) => [w.word, w.accepted])).toEqual([
      ['The', false],
      ['Sound', true],
      ['of', false],
    ])
    expect(result.sharedWords[0]?.why).toBe('"The" is a stopword, and this room ignores them')
  })

  it('explains a loose match in both spellings', () => {
    const prev = track("Drivin' My Life Away", 'Eddie Rabbitt')
    const next = track('Driving Home For Christmas', 'Chris Rea')
    const result = explain(prev, next, [entry(prev)], settings())
    expect(result.sharedWords[0]).toMatchObject({ word: 'Driving', accepted: true, via: 'loose' })
    expect(result.sharedWords[0]?.why).toBe('"Driving" matches "Drivin\'" in the previous title')
  })

  it('explains an artist-side link', () => {
    const prev = track('Goodbye Yellow Brick Road', 'Elton John')
    const next = track('Sunshine', 'Yellow Days')
    const result = explain(prev, next, [entry(prev)], settings({ matchScope: 'titleAndArtist' }))
    expect(result.sharedWords[0]?.why).toBe(
      '"Yellow" is in the previous title (from this song\'s artist)',
    )
    expect(result.sharedWords[0]?.field).toBe('artist')
  })

  it('explains a spent word and says which turn spent it', () => {
    const seed = track('Goodbye Yellow Brick Road', 'Elton John')
    const second = track('Yellow Submarine', 'The Beatles')
    const history = [entry(seed), entry(second, 'Yellow')]
    const next = track('Yellow Sunshine', 'The Kinks')
    const burnOnce = explain(second, next, history, settings({ wordReuse: 'burnOnce' }))
    expect(burnOnce.sharedWords[0]?.why).toBe('"Yellow" was already spent as the link on turn 2')

    const noConsecutive = explain(second, next, history, settings({ wordReuse: 'noConsecutive' }))
    expect(noConsecutive.sharedWords[0]?.why).toBe(
      '"Yellow" was the link last turn, and this room blocks the same word twice in a row',
    )
  })

  it('returns an empty list when nothing is shared', () => {
    const prev = track('Goodbye Yellow Brick Road', 'Elton John')
    const next = track('Smells Like Teen Spirit', 'Nirvana')
    expect(explain(prev, next, [entry(prev)], settings())).toEqual({ sharedWords: [] })
  })

  it('gives a highlight range that points at the candidate title', () => {
    const prev = track('Goodbye Yellow Brick Road', 'Elton John')
    const next = track('Yellow Submarine - Remastered 2009', 'The Beatles')
    const [word] = explain(prev, next, [entry(prev)], settings()).sharedWords
    const range = word?.range
    expect(range).toBeDefined()
    expect(next.title.slice(range?.[0] ?? 0, range?.[1] ?? 0)).toBe('Yellow')
  })
})

describe('explain accounts for rejections that are not about words', () => {
  it('explains a duplicate track', () => {
    const prev = track('Yellow Submarine', 'The Beatles')
    const repeat = withId(prev.id, track('Yellow Submarine', 'The Beatles'))
    const result = explain(prev, repeat, [entry(prev)], settings())
    expect(result.blockers?.[0]).toEqual({
      kind: 'duplicate-song',
      why: '"Yellow Submarine" is already in the chain, from turn 1',
    })
  })

  it('explains a remaster of a song already played', () => {
    const seed = track('Yellow Submarine', 'The Beatles')
    const second = track('Submarine Bells', 'The Chills')
    const remaster = track('Yellow Submarine - Remastered 2009', 'The Beatles')
    const history = [entry(seed), entry(second, 'Submarine')]
    const result = explain(second, remaster, history, settings({ artistCooldown: 0 }))
    expect(result.blockers?.[0]?.why).toBe(
      '"Yellow Submarine" is already in the chain from turn 1 -- same song, different release',
    )
  })

  it('explains an artist cooldown', () => {
    const prev = track('Yellow Submarine', 'Yellow Days')
    const next = track('Submarine Dreams', 'Yellow Days')
    const result = explain(prev, next, [entry(prev)], settings())
    expect(result.blockers?.[0]).toEqual({
      kind: 'artist-cooldown',
      why: 'Yellow Days was picked 1 turn ago, and this room blocks the same artist within 1',
    })
  })

  it('pluralises the cooldown message', () => {
    const seed = track('Yellow Submarine', 'Yellow Days')
    const second = track('Submarine Bells', 'The Chills')
    const next = track('Bells of Yellow', 'Yellow Days')
    const history = [entry(seed), entry(second, 'Submarine')]
    const result = explain(second, next, history, settings({ artistCooldown: 3 }))
    expect(result.blockers?.[0]?.why).toBe(
      'Yellow Days was picked 2 turns ago, and this room blocks the same artist within 3',
    )
  })

  it('still reports the word as usable, because the word is not the problem', () => {
    const prev = track('Yellow Submarine', 'Yellow Days')
    const next = track('Submarine Dreams', 'Yellow Days')
    const result = explain(prev, next, [entry(prev)], settings())
    expect(result.sharedWords[0]).toMatchObject({ word: 'Submarine', accepted: true })
    expect(result.blockers).toHaveLength(1)
  })
})

describe('explain and validate never disagree', () => {
  const prev = track('The Sound of Silence', 'Simon & Garfunkel')
  const cases = [
    track('The Sound of Music', 'Rodgers & Hammerstein'),
    track('The Chain', 'Fleetwood Mac'),
    track('Smells Like Teen Spirit', 'Nirvana'),
    track('Sounding Off', 'The Chills'),
  ]

  it.each(cases)('$title', (candidate) => {
    const history = [entry(prev)]
    const result = validate(prev, candidate, history, settings())
    const reasons = explain(prev, candidate, history, settings())
    const hasUsableWord = reasons.sharedWords.some((w) => w.accepted)
    const blocked = (reasons.blockers ?? []).length > 0
    expect(result.valid).toBe(hasUsableWord && !blocked)
  })
})
