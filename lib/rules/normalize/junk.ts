/**
 * Version-junk vocabulary.
 *
 * Spotify titles carry an enormous amount of release metadata in the title
 * field itself: `- 2009 Remaster`, `(Deluxe Edition)`, `- From "Barbie The
 * Album"`. None of it is part of the song's name, so none of it should be able
 * to form a link in the game.
 *
 * This is deliberately a *tunable heuristic*, not a closed grammar. The rules
 * are exported by name so step 2 (the search sanity-check page) can audit them
 * against real search results, and so a test can point at the exact rule that
 * fired. Every rule tests against a lowercased, whitespace-collapsed string.
 */

export type JunkRule = {
  name: string
  test: RegExp
}

/** Rules shared by parentheticals and trailing dash segments. */
const VERSION_JUNK: readonly JunkRule[] = [
  // `- 2009 Remaster`, `(Remastered 2011)`, `- Digitally Remastered`
  { name: 'remaster', test: /\bremaster(ed|ing)?\b/ },
  // `- Single Version`, `- Radio Edit`, `(Taylor's Version)`, `- 2011 Mix`
  { name: 'version-suffix', test: /\b(version|edit|mix|cut|recording|rerecording|re-recording)$/ },
  // `- Kaytranada Remix`, `(Dub)`
  { name: 'remix', test: /\b(remix(es)?|dub|vip|bootleg|rework|flip)$/ },
  // `- Live at Wembley`, `(Live)`, `- Live 1975`
  { name: 'live', test: /^live\b|\blive (at|in|from|on)\b|\brecorded live\b/ },
  // `(Deluxe Edition)`, `- Anniversary Edition`, `(Expanded)`
  {
    name: 'edition',
    test: /\b(deluxe|expanded|special|anniversary|legacy|collectors?|collector's|platinum|reissue|remaster)\b/,
  },
  { name: 'bonus-track', test: /\bbonus\s+track\b/ },
  { name: 'demo', test: /\bdemo\b/ },
  { name: 'take', test: /^(take|alternate|alternative|alt)\b.*$|^\d+(st|nd|rd|th)?\s+take$/ },
  { name: 'explicit-clean', test: /^(explicit|clean)(\s+version)?$/ },
  {
    name: 'karaoke',
    test: /\b(karaoke|instrumental|a cappella|acapella|backing track|made popular by|in the style of)\b/,
  },
  { name: 'sped-slowed', test: /\b(sped up|speed up|slowed(\s+(down|reverb))?|nightcore|8d audio|reverb)\b/ },
  { name: 'mono-stereo', test: /^(mono|stereo)\b/ },
  // `- From "Barbie The Album"`, `(Music From The Motion Picture)`
  {
    name: 'from-media',
    test: /^(from|music from|theme from|as (featured|heard) in|inspired by)\b/,
  },
  {
    name: 'soundtrack',
    test: /\b(soundtrack|original motion picture|motion picture|broadway cast|original cast|ost)\b/,
  },
  { name: 'format', test: /^(vinyl|digital|cd|itunes|7"|12"|maxi|b-side|single|album)\b/ },
  { name: 'acoustic-etc', test: /^(acoustic|unplugged|orchestral|symphonic|piano|extended|original|short|long|full)(\s+(version|mix|edit))?$/ },
]

/** Feature credits. Stripped inside brackets and after a dash. */
const FEATURE_JUNK: readonly JunkRule[] = [
  { name: 'feature', test: /^(feat\.?|ft\.?|featuring|w\/|with)\b/ },
]

/** Applies to the contents of `(...)` and `[...]`. */
export const JUNK_PAREN: readonly JunkRule[] = [...VERSION_JUNK, ...FEATURE_JUNK]

/** Applies to trailing ` - ` delimited segments. */
export const JUNK_SEGMENT: readonly JunkRule[] = [...VERSION_JUNK, ...FEATURE_JUNK]

/**
 * A bare feature credit with no bracket or dash around it:
 * `Waiting On A Friend feat. Sonny Rollins`.
 *
 * Note the absence of a bare `with`: too many real titles use it
 * ("Sunday Morning Coming Down with..."), so `with` only counts as junk when
 * it is fenced inside a bracket.
 */
export const BARE_FEATURE = /\s+(feat\.|feat\b|ft\.|ft\b|featuring\b|w\/)/i

/** Collapse a fragment to the form the junk rules expect. */
export function junkKey(fragment: string): string {
  return fragment.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** The name of the first rule that fires, or null if the fragment looks real. */
export function matchJunk(fragment: string, rules: readonly JunkRule[]): string | null {
  const key = junkKey(fragment)
  if (key.length === 0) return null
  for (const rule of rules) {
    if (rule.test.test(key)) return rule.name
  }
  return null
}
