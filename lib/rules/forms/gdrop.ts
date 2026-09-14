/**
 * Dropped-g restoration: `drivin` -> `driving`, so `Drivin' My Life Away`
 * links to `Driving`.
 *
 * This runs *before* stemming because Porter mangles the case on its own:
 * `stemmer('lovin') === 'lovin'`, which matches nothing.
 *
 * The naive version of this rule -- append `g` to anything ending in `-in` --
 * is a false-positive machine: it makes "Sin" link to "Sing", "Thin" to
 * "Thing", "Raisin" to "Raising". The fix is to notice that the difference is
 * whether the token is *already* an English word. That list is short and
 * closed enough to enumerate, so it is a denylist rather than a guess.
 */

/**
 * Real English words (and common proper nouns) ending in `-in`, which must
 * never be treated as a dropped-g gerund.
 *
 * Load-bearing entries are the ones where the restored form is also a real
 * word and would create a bogus link: thin/thing, satin/sating,
 * basin/basing, ruin/ruing, robin/robing, raisin/raising, aspirin/aspiring.
 */
export const REAL_IN_WORDS: ReadonlySet<string> = new Set([
  // monosyllables and near-monosyllables
  'chin', 'thin', 'shin', 'skin', 'spin', 'grin', 'twin', 'akin', 'coin', 'join',
  'loin', 'groin', 'rain', 'main', 'gain', 'pain', 'vain', 'lain', 'fain', 'wain',
  'brain', 'train', 'stain', 'plain', 'chain', 'slain', 'grain', 'strain', 'sprain',
  'drain', 'swain', 'again', 'begin', 'bruin', 'ruin', 'resin', 'rosin', 'satin',
  'latin', 'robin', 'cabin', 'basin', 'cumin', 'muslin', 'poplin', 'marlin', 'merlin',
  'kaolin', 'lanolin', 'jasmin', 'tannin', 'toxin', 'dioxin', 'casein', 'protein',
  'heroin', 'sirloin', 'virgin', 'margin', 'origin', 'cousin', 'raisin', 'gherkin',
  'napkin', 'catkin', 'munchkin', 'pumpkin', 'sequin', 'urchin', 'goblin', 'gremlin',
  'kremlin', 'javelin', 'violin', 'mandolin', 'mandarin', 'moccasin', 'assassin',
  'insulin', 'aspirin', 'vitamin', 'gelatin', 'bulletin', 'terrapin', 'tarpaulin',
  'zeppelin', 'adrenalin', 'nicotin', 'penguin', 'dolphin', 'muffin', 'coffin',
  'harlequin', 'mannequin', 'welkin', 'tocsin',
  // -skin / -pin compounds
  'wineskin', 'buckskin', 'sheepskin', 'foreskin', 'pigskin', 'bearskin', 'doeskin',
  'oilskin', 'sealskin', 'deerskin', 'hairpin', 'kingpin', 'tailspin', 'backspin',
  'topspin', 'linchpin',
  // adverbs
  'within', 'wherein', 'herein', 'therein',
  // common proper nouns
  'austin', 'berlin', 'dublin', 'martin', 'franklin', 'kevin', 'calvin', 'marvin',
  'melvin', 'colin', 'lenin', 'stalin', 'ruskin', 'pekin',
])

/**
 * The restored `-ing` form, or null if this token should be left alone.
 *
 * The policy is allow-by-default with an explicit denylist, not the reverse:
 * almost every `-in` word in a song title really is a dropped g, and a
 * speculative key only ever produces a link if the *other* side independently
 * stems to the same form. A trailing apostrophe in the source (`drivin'`) is
 * the strongest signal available and overrides the denylist.
 */
export function gDropRestore(norm: string, elided: boolean): string | null {
  // At least two letters before the `-in`, which excludes the three-letter
  // real words outright: sin, win, gin, pin, tin, kin, fin, bin, din.
  if (!/^[a-z]{2,}in$/.test(norm)) return null
  if (elided) return `${norm}g`
  if (REAL_IN_WORDS.has(norm)) return null
  return `${norm}g`
}
