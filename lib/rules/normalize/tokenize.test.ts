import { describe, expect, it } from 'vitest'
import { normalizeTitle, tokenizeArtist, tokenizeTitle, normalizeWord } from './tokenize'
import { stripJunkRanges } from './strip'

const norm = (title: string): string[] => tokenizeTitle(title).map((t) => t.norm)

describe('trailing version junk is stripped', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['Goodbye Yellow Brick Road - Remastered 2014', 'goodbye yellow brick road'],
    ['Bohemian Rhapsody - Remastered 2011', 'bohemian rhapsody'],
    ['Africa - 2020 Remaster', 'africa'],
    ['Satisfaction - Single Version', 'satisfaction'],
    ['The Sound of Silence - Acoustic Version', 'the sound of silence'],
    ['Everybody (Backstreet’s Back) - Radio Edit', 'everybody backstreets back'],
    ['Purple Rain (Live)', 'purple rain'],
    ['Tiny Dancer (Live at Dodger Stadium)', 'tiny dancer'],
    ['Sweet Caroline (Deluxe Edition)', 'sweet caroline'],
    ['Money For Nothing (Remastered 2005)', 'money for nothing'],
    ['Love Story (Taylor’s Version)', 'love story'],
    ['Dancing Queen - 2016 Mix', 'dancing queen'],
    ['Hotel California - 2013 Remaster', 'hotel california'],
    ['Blinding Lights - Instrumental', 'blinding lights'],
    ['Take Five - Mono Version', 'take five'],
    ['Hey Jude - Take 2', 'hey jude'],
    ['Hurt - Demo', 'hurt'],
    ['Come Together - Bonus Track', 'come together'],
    ['Landslide - 2004 Remaster', 'landslide'],
    ['Wonderwall - Sped Up', 'wonderwall'],
  ]
  it.each(cases)('%s', (input, expected) => {
    expect(norm(input).join(' ')).toBe(expected)
  })
})

describe('leading parentheticals are part of the real title', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["(Don't Fear) The Reaper", 'dont fear the reaper'],
    ["(I Can't Get No) Satisfaction", 'i cant get no satisfaction'],
    ['(Sittin’ On) The Dock of the Bay', 'sittin on the dock of the bay'],
    ["(You Make Me Feel Like) A Natural Woman", 'you make me feel like a natural woman'],
    // Real leading parenthetical plus genuine trailing junk.
    ["(Don't Fear) The Reaper - Remastered", 'dont fear the reaper'],
  ]
  it.each(cases)('%s', (input, expected) => {
    expect(norm(input).join(' ')).toBe(expected)
  })
})

describe('non-junk parentheticals are kept', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['Runaway (U & I)', 'runaway u i'],
    ['Time (Clock of the Heart)', 'time clock of the heart'],
    ['Everybody (Backstreet’s Back)', 'everybody backstreets back'],
    ['Smooth Criminal (Annie Are You OK)', 'smooth criminal annie are you ok'],
    ['Bad Moon Rising (Part 2)', 'bad moon rising part 2'],
  ]
  it.each(cases)('%s', (input, expected) => {
    expect(norm(input).join(' ')).toBe(expected)
  })
})

describe('feature credits are stripped', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['Stay (feat. Justin Bieber)', 'stay'],
    ['Barbie World (with Aqua)', 'barbie world'],
    ['Waiting On A Friend feat. Sonny Rollins', 'waiting on a friend'],
    ['One Dance ft. Wizkid', 'one dance'],
    // Only the feature segment goes: a junk-looking word in the primary
    // segment is left alone, since nothing marks it as metadata.
    ['Savage Remix - feat. Beyoncé', 'savage remix'],
    ['Barbie World (with Aqua) [From "Barbie The Album"]', 'barbie world'],
  ]
  it.each(cases)('%s', (input, expected) => {
    expect(norm(input).join(' ')).toBe(expected)
  })

  it('keeps a bare "with" that is part of the title', () => {
    expect(norm('Sunday Morning Coming Down with the Band').join(' ')).toBe(
      'sunday morning coming down with the band',
    )
  })
})

describe('stacked junk', () => {
  it('strips a dash segment and a parenthetical together', () => {
    expect(norm('Money For Nothing - Remastered 2005 (Deluxe Edition)').join(' ')).toBe(
      'money for nothing',
    )
  })

  it('walks multiple junk segments right to left', () => {
    expect(norm('Let It Be - Remastered 2009 - Mono Version').join(' ')).toBe('let it be')
  })

  it('stops at the first segment that looks real', () => {
    expect(norm('Frankie Teardrop - Part One - Remastered').join(' ')).toBe(
      'frankie teardrop part one',
    )
  })

  it('keeps a real dash segment carrying a junk parenthetical', () => {
    expect(norm("Song - Don't Fear (Remastered)").join(' ')).toBe('song dont fear')
  })

  it('never strips every segment', () => {
    expect(norm('Remastered - Remastered').join(' ')).toBe('remastered')
  })
})

describe('diacritics and non-decomposing letters', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['Hoppípolla', 'hoppipolla'],
    ['Björk', 'bjork'],
    ['Motörhead', 'motorhead'],
    ['Crüel Summer', 'cruel summer'],
    ['Strømmen', 'strommen'],
    ['Grüße', 'grusse'],
    ['Ænima', 'aenima'],
    ['Þú', 'thu'],
  ]
  it.each(cases)('%s', (input, expected) => {
    expect(norm(input).join(' ')).toBe(expected)
  })
})

describe('apostrophes', () => {
  it('preserves intra-word apostrophes before splitting', () => {
    expect(norm("Don't Stop Me Now")).toEqual(['dont', 'stop', 'me', 'now'])
  })

  it('handles curly apostrophes identically', () => {
    expect(norm('Don’t Stop Me Now')).toEqual(['dont', 'stop', 'me', 'now'])
  })

  it('keeps a dropped-g word whole and marks it elided', () => {
    const tokens = tokenizeTitle("Drivin' My Life Away")
    expect(tokens.map((t) => t.norm)).toEqual(['drivin', 'my', 'life', 'away'])
    expect(tokens[0]?.elided).toBe(true)
    expect(tokens[0]?.raw).toBe("Drivin'")
  })

  it('does not mark possessives as elided', () => {
    const tokens = tokenizeTitle("Backstreet's Back")
    expect(tokens.map((t) => t.norm)).toEqual(['backstreets', 'back'])
    expect(tokens[0]?.elided).toBe(false)
  })

  it("survives rock 'n' roll", () => {
    expect(norm("Rock 'n' Roll")).toEqual(['rock', 'n', 'roll'])
  })
})

describe('digits and punctuation', () => {
  it('keeps digits as tokens', () => {
    expect(norm('99 Luftballons')).toEqual(['99', 'luftballons'])
    expect(norm('7 rings')).toEqual(['7', 'rings'])
    expect(norm('Mambo No. 5')).toEqual(['mambo', 'no', '5'])
  })

  it('splits on slashes, ampersands and em dashes inside a kept title', () => {
    expect(norm('Runaway (U & I)')).toEqual(['runaway', 'u', 'i'])
    expect(norm('Hits/Misses')).toEqual(['hits', 'misses'])
  })
})

describe('token offsets index the original title', () => {
  it('points at the raw substring, junk included in the source', () => {
    const title = 'Goodbye Yellow Brick Road - Remastered 2014'
    const tokens = tokenizeTitle(title)
    const yellow = tokens.find((t) => t.norm === 'yellow')
    expect(yellow).toBeDefined()
    expect(title.slice(yellow?.start ?? 0, yellow?.end ?? 0)).toBe('Yellow')
  })

  it('survives diacritics that change length when normalized', () => {
    const title = 'Hoppípolla Forever'
    const tokens = tokenizeTitle(title)
    expect(tokens[1]?.norm).toBe('forever')
    expect(title.slice(tokens[1]?.start ?? 0, tokens[1]?.end ?? 0)).toBe('Forever')
  })
})

describe('edge cases', () => {
  it('handles an empty or junk-only title', () => {
    expect(norm('')).toEqual([])
    expect(norm('   ')).toEqual([])
  })

  it('handles an unterminated parenthetical', () => {
    expect(norm('Tiny Dancer (Live at Dodger')).toEqual(['tiny', 'dancer'])
  })

  it('handles nested brackets', () => {
    expect(norm('Song (Live (1975) Remaster)')).toEqual(['song'])
  })

  it('does not treat a hyphenated word as a segment delimiter', () => {
    expect(norm('Rock-A-Bye Baby')).toEqual(['rock', 'a', 'bye', 'baby'])
  })

  it('reports which rule fired, for the debug view', () => {
    const stripped = stripJunkRanges('Bohemian Rhapsody - Remastered 2011')
    expect(stripped).toHaveLength(1)
    expect(stripped[0]?.rule).toBe('remaster')
    expect(stripped[0]?.source).toBe('segment')
  })
})

describe('real Spotify titles, from a live search audit', () => {
  // Every case below came out of an audit of ~450 titles returned by the live
  // API. The first four are the misses that audit found.
  const cases: ReadonlyArray<readonly [string, string]> = [
    // A trailing recording date used to halt the right-to-left walk, leaving
    // the "Live At The Fillmore" segment in the title.
    [
      "(Sittin' On) The Dock of the Bay - Live At The Fillmore, San Francisco, CA - July 2008",
      'sittin on the dock of the bay',
    ],
    ['Layla - Acoustic Live', 'layla'],
    ['Cruel Summer - Live from TS | The Eras Tour', 'cruel summer'],
    ["(Sittin' on) The Dock of the Bay - 2020 Remaster", 'sittin on the dock of the bay'],
    // Leading parentheticals survived the audit intact, in every spelling.
    ["(I Can't Get No) Satisfaction - Mono", 'i cant get no satisfaction'],
    ['(I Can\u2019t Get No) Satisfaction', 'i cant get no satisfaction'],
    [
      '(I\u2019ve Had) The Time Of My Life - theme from the motion picture "Dirty Dancing"',
      'ive had the time of my life',
    ],
    // Junk in its natural habitat.
    ['While My Guitar Gently Weeps - Remastered 2009', 'while my guitar gently weeps'],
    ['All The Stars (with SZA) - From "Black Panther: The Album"', 'all the stars'],
    ['Dance The Night - From Barbie The Album', 'dance the night'],
    ['Karaoke Night - karaoke version', 'karaoke night'],
    ['Satisfaction - Push Push Push - Slowed + Reverb', 'satisfaction push push push'],
    ['Sweet Child O\u2019 Mine - Tim Simenon 7" Remix', 'sweet child o mine'],
    ['Enter Sandman - (Piano Lullaby Instrumental Version)', 'enter sandman'],
    ['Cruel Summer (Taylor\u2019s Version)', 'cruel summer'],
    ['Money Trees (feat. Jay Rock)', 'money trees'],
  ]
  it.each(cases)('%s', (input, expected) => {
    expect(norm(input).join(' ')).toBe(expected)
  })

  it('lets leading position win over the junk vocabulary', () => {
    // The two halves of the heuristic can disagree. Leading position wins,
    // because a real title is far more likely than metadata in front.
    expect(norm('(Remastered) The Song').join(' ')).toBe('remastered the song')
    expect(norm('The Song (Remastered)').join(' ')).toBe('the song')
  })

  it('keeps a song genuinely titled with a junk word', () => {
    // These are real titles. Only a bracket or a dash marks metadata, so a
    // junk-looking word in the primary segment has to survive.
    expect(norm('Live Wire').join(' ')).toBe('live wire')
    expect(norm('Bonus Track').join(' ')).toBe('bonus track')
    expect(norm('Stereo Love').join(' ')).toBe('stereo love')
    expect(norm('Mixed Emotions').join(' ')).toBe('mixed emotions')
    expect(norm('Demo Tape').join(' ')).toBe('demo tape')
  })

  it('does not strip a bare year that is part of the title', () => {
    expect(norm('1999').join(' ')).toBe('1999')
    expect(norm('Summer of 69').join(' ')).toBe('summer of 69')
    expect(norm('Live 1999 Forever').join(' ')).toBe('live 1999 forever')
  })
})

describe('non-Latin titles', () => {
  it('keeps words in scripts that do not fold to ASCII', () => {
    // The audit turned up `\u597d\u304d!! - Karaoke Ver`, which normalized to nothing at
    // all: the song could never be picked, and never be linked from.
    expect(norm('\u597d\u304d!! - Karaoke Ver').join(' ')).toBe('\u597d\u304d')
    expect(norm('\u041f\u0435\u0441\u043d\u044f \u043e \u0434\u0440\u0443\u0433\u0435 - Remastered').join(' ')).toBe('\u043f\u0435\u0441\u043d\u044f \u043e \u0434\u0440\u0443\u0433\u0435')
    expect(norm('\uac70\uc9d3\ub9d0 (Lie)').join(' ')).toBe('\uac70\uc9d3\ub9d0 lie')
  })

  it('still folds accented Latin to ASCII', () => {
    expect(norm('Hopp\u00edpolla').join(' ')).toBe('hoppipolla')
    expect(norm('Sm\u00e1sk\u00edfa 1').join(' ')).toBe('smaskifa 1')
  })
})

describe('artist tokenization', () => {
  it('splits artist names without junk stripping', () => {
    expect(tokenizeArtist('Simon & Garfunkel').map((t) => t.norm)).toEqual(['simon', 'garfunkel'])
    expect(tokenizeArtist('Sigur Rós').map((t) => t.norm)).toEqual(['sigur', 'ros'])
  })

  it('marks every token as artist-field', () => {
    expect(tokenizeArtist('Yellow Days').every((t) => t.field === 'artist')).toBe(true)
  })
})

describe('normalizeTitle and normalizeWord', () => {
  it('joins normalized tokens', () => {
    expect(normalizeTitle('Bohemian Rhapsody - Remastered 2011')).toBe('bohemian rhapsody')
  })

  it('normalizes a single stored word', () => {
    expect(normalizeWord("Drivin'")?.norm).toBe('drivin')
    expect(normalizeWord("Drivin'")?.elided).toBe(true)
    expect(normalizeWord('  ')).toBeNull()
  })
})
