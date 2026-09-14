import type { Token, TokenField } from '../types'
import { DEFAULT_NORMALIZE_OPTIONS, isKept, stripJunkRanges, type NormalizeOptions, type StrippedRange } from './strip'

/**
 * Characters Unicode NFKD refuses to decompose. Everything else (é, ö, å, ñ)
 * decomposes to a base letter plus a combining mark, which we drop.
 */
const CHAR_MAP: Readonly<Record<string, string>> = {
  'ß': 'ss',
  'æ': 'ae',
  'œ': 'oe',
  'ø': 'o',
  'đ': 'd',
  'ð': 'd',
  'þ': 'th',
  'ł': 'l',
  'ı': 'i',
  'ħ': 'h',
  'ŋ': 'n',
  'ŧ': 't',
  'ĸ': 'k',
  'ə': 'e',
  'ʒ': 'z',
}

const APOSTROPHES = new Set(["'", '’', 'ʼ', '‘', '´', '`', '＇'])

/**
 * One character's contribution to a normalized token; '' means separator.
 *
 * Letters outside ASCII are kept as themselves rather than dropped. Dropping
 * them left a title like `好き!! - Karaoke Ver` with no words at all, so the
 * song could never be picked or linked from; keeping them means Japanese,
 * Korean, Cyrillic and Greek titles can play. Accented Latin still folds to
 * ASCII through NFKD above, so `Hoppípolla` stays `hoppipolla`.
 */
function normalizeChar(ch: string): string {
  const lower = ch.toLowerCase()
  const mapped = CHAR_MAP[lower]
  if (mapped !== undefined) return mapped
  // NFKD then drop combining marks folds accented Latin to ASCII. The NFC
  // pass afterwards matters for Hangul: NFKD splits a syllable into Jamo
  // *letters*, which are not marks and so survive, leaving tokens in
  // decomposed form. Recomposing keeps every token canonical.
  const folded = lower.normalize('NFKD').replace(/\p{M}+/gu, '')
  if (/^[a-z0-9]+$/.test(folded)) return folded
  const recomposed = folded.normalize('NFC')
  return /^[\p{L}\p{N}]+$/u.test(recomposed) ? recomposed : ''
}

/**
 * Walk the source string one character at a time, so every token keeps exact
 * offsets into the original text. Splitting a pre-normalized string would be
 * simpler but would lose them: NFKD and diacritic stripping both change length.
 */
function scan(text: string, field: TokenField, stripped: readonly StrippedRange[] | null): Token[] {
  const tokens: Token[] = []
  let norm = ''
  let start = -1
  let end = -1

  const flush = (elided: boolean): void => {
    if (norm.length > 0 && start >= 0) {
      tokens.push({ norm, raw: text.slice(start, end), start, end, field, elided })
    }
    norm = ''
    start = -1
    end = -1
  }

  for (let i = 0; i < text.length; i += 1) {
    if (stripped !== null && !isKept(i, stripped)) {
      flush(false)
      continue
    }
    const ch = text[i] as string
    const contribution = normalizeChar(ch)
    if (contribution.length > 0) {
      if (start < 0) start = i
      norm += contribution
      end = i + 1
      continue
    }
    if (APOSTROPHES.has(ch) && norm.length > 0) {
      // Preserve intra-word apostrophes before splitting: `don't` must become
      // `dont`, not `don` + `t`.
      const nextIndex = i + 1
      const nextVisible = stripped === null || isKept(nextIndex, stripped)
      const next =
        nextIndex < text.length && nextVisible ? normalizeChar(text[nextIndex] as string) : ''
      end = i + 1
      if (next.length > 0) continue
      // A trailing apostrophe is a dropped g: `drivin'`.
      flush(true)
      continue
    }
    flush(false)
  }
  flush(false)
  return tokens
}

/** Words of a song title, with release metadata removed. */
export function tokenizeTitle(
  title: string,
  opts: NormalizeOptions = DEFAULT_NORMALIZE_OPTIONS,
): Token[] {
  return scan(title, 'title', stripJunkRanges(title, opts))
}

/** Words of an artist name. Artist names carry no version junk. */
export function tokenizeArtist(name: string): Token[] {
  return scan(name, 'artist', null)
}

export function tokenizeArtists(names: readonly string[]): Token[] {
  return names.flatMap((name) => tokenizeArtist(name))
}

/** Normalized title as a single string, for duplicate-song comparison. */
export function normalizeTitle(
  title: string,
  opts: NormalizeOptions = DEFAULT_NORMALIZE_OPTIONS,
): string {
  return tokenizeTitle(title, opts)
    .map((t) => t.norm)
    .join(' ')
}

export function normalizeArtistName(name: string): string {
  return tokenizeArtist(name)
    .map((t) => t.norm)
    .join(' ')
}

/** Normalize a single bare word, e.g. a stored `matchedWord`. */
export function normalizeWord(word: string): Token | null {
  return scan(word, 'title', null)[0] ?? null
}
