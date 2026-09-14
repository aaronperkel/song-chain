import { describe, expect, it } from 'vitest'
import { validate } from '../validate'
import { entry, settings, track, withId } from './fixtures'

describe('the basic game', () => {
  it('accepts a title sharing a word', () => {
    const prev = track('Goodbye Yellow Brick Road', 'Elton John')
    const next = track('Yellow Submarine', 'The Beatles')
    expect(validate(prev, next, [entry(prev)], settings())).toEqual({
      valid: true,
      matchedWord: 'Yellow',
      matchedOn: 'title',
      via: 'exact',
    })
  })

  it('rejects a title sharing nothing', () => {
    const prev = track('Goodbye Yellow Brick Road', 'Elton John')
    const next = track('Smells Like Teen Spirit', 'Nirvana')
    expect(validate(prev, next, [entry(prev)], settings())).toEqual({
      valid: false,
      reason: 'no-shared-word',
    })
  })

  it('matches through release junk on either side', () => {
    const prev = track('Goodbye Yellow Brick Road - Remastered 2014', 'Elton John')
    const next = track('Yellow Submarine (Remastered 2009)', 'The Beatles')
    const result = validate(prev, next, [entry(prev)], settings())
    expect(result).toMatchObject({ valid: true, matchedWord: 'Yellow' })
  })

  it('reports the raw word, not the normalized one', () => {
    const prev = track("Drivin' My Life Away", 'Eddie Rabbitt')
    const next = track('Driving Home For Christmas', 'Chris Rea')
    expect(validate(prev, next, [entry(prev)], settings())).toEqual({
      valid: true,
      matchedWord: 'Driving',
      matchedOn: 'title',
      via: 'loose',
    })
  })
})

describe('stopwords', () => {
  const prev = track('The Sound of Silence', 'Simon & Garfunkel')

  it('rejects a pick that only shares a stopword', () => {
    const next = track('The Chain', 'Fleetwood Mac')
    expect(validate(prev, next, [entry(prev)], settings())).toEqual({
      valid: false,
      reason: 'stopword-only',
    })
  })

  it('accepts it when the room allows stopwords', () => {
    const next = track('The Chain', 'Fleetwood Mac')
    expect(validate(prev, next, [entry(prev)], settings({ stopwords: 'allow' }))).toMatchObject({
      valid: true,
      matchedWord: 'The',
    })
  })

  it('prefers a real word over a stopword when both are shared', () => {
    const next = track('The Sound of Music', 'Rodgers & Hammerstein')
    expect(validate(prev, next, [entry(prev)], settings())).toMatchObject({
      valid: true,
      matchedWord: 'Sound',
    })
  })
})

describe('matchScope', () => {
  const prev = track('Goodbye Yellow Brick Road', 'Elton John')

  it('ignores artist words by default', () => {
    const next = track('Sunshine', 'Yellow Days')
    expect(validate(prev, next, [entry(prev)], settings())).toEqual({
      valid: false,
      reason: 'no-shared-word',
    })
  })

  it('allows an artist word to form the link when scoped to both', () => {
    const next = track('Sunshine', 'Yellow Days')
    expect(
      validate(prev, next, [entry(prev)], settings({ matchScope: 'titleAndArtist' })),
    ).toEqual({
      valid: true,
      matchedWord: 'Yellow',
      matchedOn: 'artist',
      via: 'exact',
    })
  })

  it('still prefers a title link when both exist', () => {
    const next = track('Yellow Submarine', 'Yellow Days')
    expect(
      validate(prev, next, [entry(prev)], settings({ matchScope: 'titleAndArtist' })),
    ).toMatchObject({ matchedOn: 'title' })
  })
})

describe('artistCooldown', () => {
  const prev = track('Yellow Submarine', 'Yellow Days')

  it('blocks the same artist on the very next pick by default', () => {
    const next = track('Submarine Dreams', 'Yellow Days')
    expect(validate(prev, next, [entry(prev)], settings())).toEqual({
      valid: false,
      reason: 'artist-cooldown',
    })
  })

  it('allows it when the cooldown is off', () => {
    const next = track('Submarine Dreams', 'Yellow Days')
    expect(validate(prev, next, [entry(prev)], settings({ artistCooldown: 0 }))).toMatchObject({
      valid: true,
    })
  })

  it('looks back N picks, not just one', () => {
    const seed = track('Yellow Submarine', 'Yellow Days')
    const second = track('Submarine Bells', 'The Chills')
    const next = track('Bells of Yellow', 'Yellow Days')
    const history = [entry(seed), entry(second, 'Submarine')]
    expect(validate(second, next, history, settings({ artistCooldown: 2 }))).toEqual({
      valid: false,
      reason: 'artist-cooldown',
    })
    expect(validate(second, next, history, settings({ artistCooldown: 1 }))).toMatchObject({
      valid: true,
    })
  })

  it('counts featured artists', () => {
    const seed = track('Yellow Submarine', ['The Beatles', 'Yellow Days'])
    const next = track('Submarine Dreams', 'Yellow Days')
    expect(validate(seed, next, [entry(seed)], settings())).toEqual({
      valid: false,
      reason: 'artist-cooldown',
    })
  })

  it('is the scenario from the brief: no artist three times running', () => {
    const seed = track('Yellow Submarine', 'The Beatles')
    const first = track('Sunshine Yellow', 'Yellow Days')
    const history = [entry(seed), entry(first, 'Yellow')]
    const again = track('Yellow Sunshine', 'Yellow Days')
    expect(validate(first, again, history, settings())).toEqual({
      valid: false,
      reason: 'artist-cooldown',
    })
  })
})

describe('allowRepeatSongs is always false', () => {
  it('blocks the identical track id', () => {
    const prev = track('Yellow Submarine', 'The Beatles')
    const repeat = withId(prev.id, track('Yellow Submarine', 'The Beatles'))
    expect(validate(prev, repeat, [entry(prev)], settings({ artistCooldown: 0 }))).toEqual({
      valid: false,
      reason: 'duplicate-song',
    })
  })

  it('blocks a remaster of a song already in the chain', () => {
    const seed = track('Yellow Submarine', 'The Beatles')
    const second = track('Submarine Bells', 'The Chills')
    const remaster = track('Yellow Submarine - Remastered 2009', 'The Beatles')
    const history = [entry(seed), entry(second, 'Submarine')]
    expect(validate(second, remaster, history, settings({ artistCooldown: 0 }))).toEqual({
      valid: false,
      reason: 'duplicate-song',
    })
  })

  it('does not confuse a cover by a different artist for a duplicate', () => {
    const seed = track('Yellow Submarine', 'The Beatles')
    const second = track('Submarine Bells', 'The Chills')
    const cover = track('Yellow Submarine', 'Sun Ra')
    const history = [entry(seed), entry(second, 'Submarine')]
    expect(validate(second, cover, history, settings({ artistCooldown: 0 }))).toMatchObject({
      valid: true,
    })
  })
})

describe('wordReuse', () => {
  const seed = track('Goodbye Yellow Brick Road', 'Elton John')
  const second = track('Yellow Submarine', 'The Beatles')
  const history = [entry(seed), entry(second, 'Yellow')]

  it('is a free-for-all by default', () => {
    const next = track('Yellow Sunshine', 'The Kinks')
    expect(validate(second, next, history, settings())).toMatchObject({
      valid: true,
      matchedWord: 'Yellow',
    })
  })

  it('noConsecutive blocks the same word twice running', () => {
    const next = track('Yellow Sunshine', 'The Kinks')
    expect(validate(second, next, history, settings({ wordReuse: 'noConsecutive' }))).toEqual({
      valid: false,
      reason: 'word-already-used',
    })
  })

  it('noConsecutive allows a different word', () => {
    const next = track('Submarine Sunshine', 'The Kinks')
    expect(
      validate(second, next, history, settings({ wordReuse: 'noConsecutive' })),
    ).toMatchObject({ valid: true, matchedWord: 'Submarine' })
  })

  it('noConsecutive forgets after one turn', () => {
    const third = track('Submarine Bells', 'The Chills')
    const longer = [...history, entry(third, 'Submarine')]
    const next = track('Yellow Bells', 'The Kinks')
    expect(validate(third, next, longer, settings({ wordReuse: 'noConsecutive' }))).toMatchObject({
      valid: true,
      matchedWord: 'Bells',
    })
  })

  it('burnOnce spends a word for the rest of the game', () => {
    const third = track('Submarine Bells', 'The Chills')
    const longer = [...history, entry(third, 'Submarine')]
    const next = track('Yellow Bells', 'The Kinks')
    const result = validate(third, next, longer, settings({ wordReuse: 'burnOnce' }))
    expect(result).toMatchObject({ valid: true, matchedWord: 'Bells' })
  })

  it('burnOnce blocks a word spent many turns ago', () => {
    const third = track('Submarine Bells', 'The Chills')
    const fourth = track('Bells of Yellow', 'Bread')
    const longer = [...history, entry(third, 'Submarine'), entry(fourth, 'Bells')]
    const next = track('Yellow Skies', 'The Kinks')
    // "Yellow" is shared with the previous title, but it was the link back on
    // turn 2 and burnOnce spends it for good.
    expect(validate(fourth, next, longer, settings({ wordReuse: 'burnOnce' }))).toEqual({
      valid: false,
      reason: 'word-already-used',
    })
  })

  it('burnOnce leaves non-link words alone', () => {
    // "Brick" and "Road" were in the seed title but never formed a link.
    const next = track('Submarine Road', 'The Kinks')
    expect(validate(second, next, history, settings({ wordReuse: 'burnOnce' }))).toMatchObject({
      valid: true,
      matchedWord: 'Submarine',
    })
  })

  it('burns loose forms together', () => {
    const seedTrack = track("Drivin' My Life Away", 'Eddie Rabbitt')
    const nextTrack = track('Driving Home For Christmas', 'Chris Rea')
    const chain = [entry(seedTrack), entry(nextTrack, 'Driving')]
    const another = track('Drivin Wheel', 'Foghat')
    expect(validate(nextTrack, another, chain, settings({ wordReuse: 'burnOnce' }))).toEqual({
      valid: false,
      reason: 'word-already-used',
    })
  })
})

describe('rejection precedence', () => {
  it('reports the duplicate ahead of the cooldown', () => {
    const prev = track('Yellow Submarine', 'The Beatles')
    const repeat = withId(prev.id, track('Yellow Submarine', 'The Beatles'))
    // Both would fire: same track, same artist as the last pick.
    expect(validate(prev, repeat, [entry(prev)], settings())).toEqual({
      valid: false,
      reason: 'duplicate-song',
    })
  })

  it('reports the cooldown ahead of a word problem', () => {
    const prev = track('Yellow Submarine', 'Yellow Days')
    const next = track('Nothing In Common', 'Yellow Days')
    // No shared word *and* an artist on cooldown: the artist is the real block.
    expect(validate(prev, next, [entry(prev)], settings())).toEqual({
      valid: false,
      reason: 'artist-cooldown',
    })
  })

  it('reports stopword-only when stopwords were the only overlap', () => {
    const prev = track('The Sound of Silence', 'Simon & Garfunkel')
    const next = track('The Chain', 'Fleetwood Mac')
    expect(validate(prev, next, [entry(prev)], settings())).toEqual({
      valid: false,
      reason: 'stopword-only',
    })
  })

  it('reports word-already-used when a real word existed but was spent', () => {
    const seed = track('The Sound of Silence', 'Simon & Garfunkel')
    const second = track('Sound and Vision', 'David Bowie')
    const history = [entry(seed), entry(second, 'Sound')]
    const next = track('The Sound of Music', 'Rodgers & Hammerstein')
    expect(validate(second, next, history, settings({ wordReuse: 'burnOnce' }))).toEqual({
      valid: false,
      reason: 'word-already-used',
    })
  })
})

describe('call styles and edge cases', () => {
  it('works when history already ends with prev', () => {
    const prev = track('Goodbye Yellow Brick Road', 'Elton John')
    const next = track('Yellow Submarine', 'The Beatles')
    expect(validate(prev, next, [entry(prev)], settings())).toMatchObject({ valid: true })
  })

  it('works when history omits prev', () => {
    const prev = track('Goodbye Yellow Brick Road', 'Elton John')
    const next = track('Yellow Submarine', 'The Beatles')
    expect(validate(prev, next, [], settings())).toMatchObject({ valid: true })
  })

  it('applies the cooldown even when history omits prev', () => {
    const prev = track('Yellow Submarine', 'Yellow Days')
    const next = track('Submarine Dreams', 'Yellow Days')
    expect(validate(prev, next, [], settings())).toEqual({
      valid: false,
      reason: 'artist-cooldown',
    })
  })

  it('uses the default settings when none are passed', () => {
    const prev = track('Goodbye Yellow Brick Road', 'Elton John')
    const next = track('Yellow Submarine', 'The Beatles')
    expect(validate(prev, next, [entry(prev)])).toMatchObject({ valid: true })
  })

  it('handles a title that normalizes to nothing', () => {
    const prev = track('Goodbye Yellow Brick Road', 'Elton John')
    const next = track('(Remastered)', 'Nobody')
    expect(validate(prev, next, [entry(prev)], settings())).toEqual({
      valid: false,
      reason: 'no-shared-word',
    })
  })

  it('handles a track with no artists', () => {
    const prev = track('Goodbye Yellow Brick Road', 'Elton John')
    const next: typeof prev = { ...track('Yellow Submarine'), artists: [] }
    expect(validate(prev, next, [entry(prev)], settings())).toMatchObject({ valid: true })
  })
})
