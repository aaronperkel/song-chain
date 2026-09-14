import { describe, expect, it } from 'vitest'
import { CODE_ALPHABET, CODE_LENGTH, generateCode, isValidCode, normalizeCode } from './codes'

describe('join codes', () => {
  it('excludes every confusable glyph the brief names, and their partners', () => {
    for (const ch of '01OIl25SZ8B') {
      expect(CODE_ALPHABET).not.toContain(ch.toUpperCase())
    }
  })

  it('generates codes of the right shape', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateCode()
      expect(code).toHaveLength(CODE_LENGTH)
      expect(isValidCode(code)).toBe(true)
    }
  })

  it('does not obviously repeat itself', () => {
    const codes = new Set(Array.from({ length: 300 }, () => generateCode()))
    expect(codes.size).toBeGreaterThan(290)
  })

  it('accepts a code typed casually', () => {
    const code = generateCode()
    expect(normalizeCode(code.toLowerCase())).toBe(code)
    expect(normalizeCode(` ${code.slice(0, 2)}-${code.slice(2)} `)).toBe(code)
    expect(isValidCode(code.toLowerCase())).toBe(true)
  })

  it('rejects a code containing an excluded glyph rather than guessing', () => {
    // Silently folding O to Q would join someone to the wrong room.
    expect(isValidCode('QQQQO')).toBe(false)
    expect(isValidCode('AAAA0')).toBe(false)
    expect(isValidCode('AAAAI')).toBe(false)
    expect(isValidCode('AAAAS')).toBe(false)
  })

  it('rejects the wrong length', () => {
    expect(isValidCode('')).toBe(false)
    expect(isValidCode('AAAA')).toBe(false)
    expect(isValidCode('AAAAAA')).toBe(false)
  })
})
