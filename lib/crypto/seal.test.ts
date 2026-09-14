import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { hashSecret, isSealed, newHostSecret, open, seal, secretMatches, SealError } from './seal'

const KEY = randomBytes(32).toString('base64')

beforeEach(() => {
  vi.stubEnv('TOKEN_ENC_KEY', KEY)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('seal and open', () => {
  it('round-trips a token', () => {
    const token = 'AQDx-refresh-token-value'
    expect(open(seal(token))).toBe(token)
  })

  it('round-trips unicode and empty strings', () => {
    expect(open(seal(''))).toBe('')
    expect(open(seal('好き 🎵 café'))).toBe('好き 🎵 café')
  })

  it('never emits the plaintext', () => {
    const sealed = seal('super-secret-refresh-token')
    expect(sealed).not.toContain('super-secret')
    expect(sealed.startsWith('v1.')).toBe(true)
  })

  it('produces a different ciphertext every time', () => {
    // A fresh IV per call, so identical tokens are not identifiable by their
    // ciphertext.
    const a = seal('same-token')
    const b = seal('same-token')
    expect(a).not.toBe(b)
    expect(open(a)).toBe(open(b))
  })

  it('rejects a tampered ciphertext instead of returning garbage', () => {
    const sealed = seal('refresh-token')
    const parts = sealed.split('.')
    const ciphertext = Buffer.from(parts[2] as string, 'base64url')
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff
    const tampered = [parts[0], parts[1], ciphertext.toString('base64url'), parts[3]].join('.')

    expect(() => open(tampered)).toThrow(SealError)
    expect(() => open(tampered)).toThrow(/failed authentication/)
  })

  it('rejects a tampered auth tag', () => {
    const parts = seal('refresh-token').split('.')
    const tag = Buffer.from(parts[3] as string, 'base64url')
    tag[0] = (tag[0] ?? 0) ^ 0xff
    expect(() =>
      open([parts[0], parts[1], parts[2], tag.toString('base64url')].join('.')),
    ).toThrow(SealError)
  })

  it('rejects a value sealed with a different key', () => {
    const sealed = seal('refresh-token')
    vi.stubEnv('TOKEN_ENC_KEY', randomBytes(32).toString('base64'))
    expect(() => open(sealed)).toThrow(/failed authentication/)
  })

  it('rejects malformed input', () => {
    expect(() => open('nonsense')).toThrow(/malformed/)
    expect(() => open('v1.a.b')).toThrow(/malformed/)
    expect(() => open('v1.tooshort.abc.abc')).toThrow(/malformed/)
  })

  it('rejects an unknown version rather than guessing', () => {
    const sealed = seal('token').split('.')
    expect(() => open(['v2', sealed[1], sealed[2], sealed[3]].join('.'))).toThrow(
      /Unknown seal version/,
    )
  })

  it('explains a missing or malformed key', () => {
    vi.stubEnv('TOKEN_ENC_KEY', '')
    expect(() => seal('x')).toThrow(/TOKEN_ENC_KEY is not set/)
    vi.stubEnv('TOKEN_ENC_KEY', Buffer.from('too-short').toString('base64'))
    expect(() => seal('x')).toThrow(/must decode to 32 bytes/)
  })

  it('recognises its own output', () => {
    expect(isSealed(seal('x'))).toBe(true)
    expect(isSealed('not-sealed')).toBe(false)
    expect(isSealed('v1.a.b')).toBe(false)
  })
})

describe('host secrets', () => {
  it('stores only a hash', () => {
    const secret = newHostSecret()
    const stored = hashSecret(secret)
    expect(stored).not.toContain(secret)
    expect(secretMatches(secret, stored)).toBe(true)
  })

  it('rejects a wrong secret', () => {
    const stored = hashSecret(newHostSecret())
    expect(secretMatches(newHostSecret(), stored)).toBe(false)
  })

  it('rejects a differently-sized candidate without throwing', () => {
    expect(secretMatches('short', 'also-a-different-length-hash')).toBe(false)
  })

  it('generates unguessable secrets', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => newHostSecret()))
    expect(secrets.size).toBe(50)
    expect(newHostSecret().length).toBeGreaterThanOrEqual(43)
  })
})
