/**
 * Digit/word equivalence for `numerals: 'loose'`: `4 ~ four`, `2 ~ two`.
 *
 * The word form is the canonical key, so a digit token gains the word as an
 * extra key and a word token already carries it.
 *
 * Deliberately limited to values that survive tokenization as a single token:
 * "ninety-nine" splits into two tokens, so no amount of table would make it
 * match "99". 0-20, the round tens, and hundred/thousand cover what actually
 * shows up in song titles.
 */
const CARDINALS: ReadonlyArray<readonly [number, string]> = [
  [0, 'zero'],
  [1, 'one'],
  [2, 'two'],
  [3, 'three'],
  [4, 'four'],
  [5, 'five'],
  [6, 'six'],
  [7, 'seven'],
  [8, 'eight'],
  [9, 'nine'],
  [10, 'ten'],
  [11, 'eleven'],
  [12, 'twelve'],
  [13, 'thirteen'],
  [14, 'fourteen'],
  [15, 'fifteen'],
  [16, 'sixteen'],
  [17, 'seventeen'],
  [18, 'eighteen'],
  [19, 'nineteen'],
  [20, 'twenty'],
  [30, 'thirty'],
  [40, 'forty'],
  [50, 'fifty'],
  [60, 'sixty'],
  [70, 'seventy'],
  [80, 'eighty'],
  [90, 'ninety'],
  [100, 'hundred'],
  [1000, 'thousand'],
]

const DIGIT_TO_WORD = new Map<string, string>(CARDINALS.map(([n, w]) => [String(n), w]))
const WORDS = new Set<string>(CARDINALS.map(([, w]) => w))

/** The canonical word form of a numeric token, or null if it isn't one. */
export function numeralWord(norm: string): string | null {
  const fromDigits = DIGIT_TO_WORD.get(norm)
  if (fromDigits !== undefined) return fromDigits
  return WORDS.has(norm) ? norm : null
}
