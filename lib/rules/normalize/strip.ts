import { BARE_FEATURE, JUNK_PAREN, JUNK_SEGMENT, matchJunk, type JunkRule } from './junk'

/** A half-open `[start, end)` span of the original string. */
export type Range = readonly [start: number, end: number]

export type StrippedRange = {
  range: Range
  /** Name of the junk rule that fired, for debugging and tests. */
  rule: string
  source: 'paren' | 'segment' | 'feature'
}

export type NormalizeOptions = {
  /**
   * A parenthetical at the very start of a title is almost always part of the
   * real title — `(Don't Fear) The Reaper`, `(I Can't Get No) Satisfaction` —
   * while a trailing one is usually release metadata. This is the tunable
   * half of the heuristic; junk vocabulary is the other half.
   */
  keepLeadingParenthetical: boolean
  parenRules: readonly JunkRule[]
  segmentRules: readonly JunkRule[]
  stripBareFeature: boolean
}

export const DEFAULT_NORMALIZE_OPTIONS: NormalizeOptions = {
  keepLeadingParenthetical: true,
  parenRules: JUNK_PAREN,
  segmentRules: JUNK_SEGMENT,
  stripBareFeature: true,
}

const OPENERS = new Set(['(', '[', '{'])
const CLOSERS = new Set([')', ']', '}'])
const DASHES = new Set(['-', '–', '—'])

type Group = { start: number; end: number; content: string }

/** Top-level bracket groups. An unterminated group runs to end of string. */
function findGroups(title: string): Group[] {
  const groups: Group[] = []
  let depth = 0
  let openAt = -1
  for (let i = 0; i < title.length; i += 1) {
    const ch = title[i] as string
    if (OPENERS.has(ch)) {
      if (depth === 0) openAt = i
      depth += 1
    } else if (CLOSERS.has(ch) && depth > 0) {
      depth -= 1
      if (depth === 0 && openAt >= 0) {
        groups.push({ start: openAt, end: i + 1, content: title.slice(openAt + 1, i) })
        openAt = -1
      }
    }
  }
  if (depth > 0 && openAt >= 0) {
    groups.push({ start: openAt, end: title.length, content: title.slice(openAt + 1) })
  }
  return groups
}

/** Bracket nesting depth at each index, so we only split dashes at depth 0. */
function depthMap(title: string): number[] {
  const depths: number[] = new Array<number>(title.length).fill(0)
  let depth = 0
  for (let i = 0; i < title.length; i += 1) {
    const ch = title[i] as string
    if (OPENERS.has(ch)) {
      depths[i] = depth
      depth += 1
    } else if (CLOSERS.has(ch) && depth > 0) {
      depth -= 1
      depths[i] = depth
    } else {
      depths[i] = depth
    }
  }
  return depths
}

/** Positions of top-level ` - ` style delimiters, as `[start, end)` spans. */
function findDelimiters(title: string, depths: readonly number[]): Range[] {
  const found: Range[] = []
  for (let i = 0; i < title.length - 2; i += 1) {
    if ((depths[i] ?? 0) !== 0) continue
    const a = title[i] as string
    const b = title[i + 1] as string
    const c = title[i + 2] as string
    if (/\s/.test(a) && DASHES.has(b) && /\s/.test(c)) {
      found.push([i, i + 3])
      i += 2
    }
  }
  return found
}

function overlaps(range: Range, ranges: readonly StrippedRange[]): boolean {
  return ranges.some((s) => range[0] < s.range[1] && s.range[0] < range[1])
}

/** The text of `range` with any already-stripped spans excised. */
function remainderOf(title: string, range: Range, stripped: readonly StrippedRange[]): string {
  let out = ''
  for (let i = range[0]; i < range[1]; i += 1) {
    if (stripped.some((s) => i >= s.range[0] && i < s.range[1])) continue
    out += title[i]
  }
  return out
}

/**
 * Character spans of `title` that are release metadata rather than part of the
 * song's name.
 *
 * Returns ranges over the *original* string rather than a rewritten title, so
 * token offsets survive normalization and the UI can highlight a matched word
 * where it actually appears.
 */
export function stripJunkRanges(
  title: string,
  opts: NormalizeOptions = DEFAULT_NORMALIZE_OPTIONS,
): StrippedRange[] {
  const stripped: StrippedRange[] = []
  const firstNonSpace = title.search(/\S/)

  // 1. Bracket groups. A leading one is presumed real; the rest are judged by
  //    the junk vocabulary.
  for (const group of findGroups(title)) {
    if (opts.keepLeadingParenthetical && group.start === firstNonSpace) continue
    const rule = matchJunk(group.content, opts.parenRules)
    if (rule !== null) {
      stripped.push({ range: [group.start, group.end], rule, source: 'paren' })
    }
  }

  // 2. Trailing dash segments, right to left, stopping at the first that looks
  //    like a real part of the title. Segment 0 is never stripped: something
  //    has to survive.
  const depths = depthMap(title)
  const delimiters = findDelimiters(title, depths)
  for (let d = delimiters.length - 1; d >= 0; d -= 1) {
    const delimiter = delimiters[d] as Range
    const segmentEnd = d === delimiters.length - 1 ? title.length : (delimiters[d + 1] as Range)[0]
    const segment: Range = [delimiter[1], segmentEnd]
    const remainder = remainderOf(title, segment, stripped)
    const rule = remainder.trim().length === 0 ? 'empty-segment' : matchJunk(remainder, opts.segmentRules)
    if (rule === null) break
    stripped.push({ range: [delimiter[0], segmentEnd], rule, source: 'segment' })
  }

  // 3. A bare feature credit with no bracket or dash to fence it.
  if (opts.stripBareFeature) {
    const match = BARE_FEATURE.exec(title)
    if (match !== null && (depths[match.index] ?? 0) === 0) {
      const range: Range = [match.index, title.length]
      if (!overlaps(range, stripped)) {
        stripped.push({ range, rule: 'bare-feature', source: 'feature' })
      }
    }
  }

  return coalesce(stripped)
}

function coalesce(stripped: StrippedRange[]): StrippedRange[] {
  const sorted = [...stripped].sort((a, b) => a.range[0] - b.range[0])
  const out: StrippedRange[] = []
  for (const item of sorted) {
    const last = out[out.length - 1]
    if (last !== undefined && item.range[0] <= last.range[1]) {
      out[out.length - 1] = {
        range: [last.range[0], Math.max(last.range[1], item.range[1])],
        rule: last.rule,
        source: last.source,
      }
      continue
    }
    out.push(item)
  }
  return out
}

/** True if index `i` of the title survived junk stripping. */
export function isKept(i: number, stripped: readonly StrippedRange[]): boolean {
  return !stripped.some((s) => i >= s.range[0] && i < s.range[1])
}
