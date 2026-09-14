import { afterEach, describe, expect, it } from 'vitest'
import { randomToken } from './nonce'

const real = globalThis.crypto

afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true })
})

/** Stand in for a browser that withholds part of the crypto API. */
function setCrypto(value: unknown): void {
  Object.defineProperty(globalThis, 'crypto', { value, configurable: true })
}

describe('randomToken', () => {
  it('returns 24 hex characters', () => {
    expect(randomToken()).toMatch(/^[0-9a-f]{24}$/)
  })

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 500 }, () => randomToken()))
    expect(seen.size).toBe(500)
  })

  // The bug this module exists for: `crypto.randomUUID` is secure-context
  // only, so it is missing on a guest phone loading the app over plain http.
  // `getRandomValues` is not, and must be all this needs.
  it('works when randomUUID is missing', () => {
    setCrypto({ getRandomValues: real.getRandomValues.bind(real) })
    expect(randomToken()).toMatch(/^[0-9a-f]{24}$/)
  })

  it('works when there is no crypto at all', () => {
    setCrypto(undefined)
    const token = randomToken()
    expect(token).toMatch(/^[0-9a-f]{24}$/)
    expect(new Set(Array.from({ length: 200 }, () => randomToken())).size).toBe(200)
  })
})
