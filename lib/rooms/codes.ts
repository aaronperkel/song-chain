import { randomInt } from 'node:crypto'

/**
 * Join codes, read aloud in a moving car and typed on a phone.
 *
 * The alphabet drops every glyph that gets misread: 0/O, 1/I/L, 5/S, 2/Z,
 * 8/B. Both halves of each confusable pair are excluded, not just one, which
 * is what makes a code unambiguous -- and it means no valid code ever
 * contains a character someone could mistake for another, so there is nothing
 * to "correct" on the way in. A mistyped character is simply not a code.
 *
 * 25 symbols over 5 characters is 9.7 million codes, against a handful of
 * live rooms. Density was never the constraint; being readable aloud in a
 * moving car was.
 */
export const CODE_ALPHABET = '34679ACDEFGHJKMNPQRTUVWXY'
export const CODE_LENGTH = 5

export function generateCode(): string {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    // randomInt, not Math.random: a guessable code is a joinable room.
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  }
  return code
}

/**
 * Accept what someone actually types -- lowercase, stray spaces or dashes --
 * without ever changing which room they land in.
 */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '')
}

export function isValidCode(input: string): boolean {
  const normalized = normalizeCode(input)
  return (
    normalized.length === CODE_LENGTH &&
    [...normalized].every((ch) => CODE_ALPHABET.includes(ch))
  )
}
