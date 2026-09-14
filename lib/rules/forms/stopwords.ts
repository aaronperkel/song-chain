/**
 * Words too common to count as a link. With `stopwords: 'ignore'` (the
 * default) a shared stopword is not a valid link -- otherwise every title
 * containing "the" would chain to every other one.
 */
export const STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'the',
  'and',
  'of',
  'in',
  'to',
  'my',
  'you',
  'is',
  'it',
])

export function isStopword(norm: string): boolean {
  return STOPWORDS.has(norm)
}
