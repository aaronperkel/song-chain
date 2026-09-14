import { describe, expect, it } from 'vitest'
import { describeAuthOutcome, type AuthOutcome } from './auth-outcome'

const failures = [
  'denied',
  'invalid',
  'expired',
  'state-mismatch',
  'not-host',
  'no-refresh-token',
  'failed',
] as const satisfies readonly Exclude<AuthOutcome, 'ok'>[]

describe('describeAuthOutcome', () => {
  it('says nothing when there was no login and nothing when it worked', () => {
    expect(describeAuthOutcome(null)).toBeNull()
    expect(describeAuthOutcome('ok', 'live')).toBeNull()
    expect(describeAuthOutcome('ok', 'manual')).toBeNull()
  })

  it('has a sentence for every outcome the callback can send', () => {
    for (const outcome of failures) {
      const copy = describeAuthOutcome(outcome)
      expect(copy, outcome).not.toBeNull()
      expect(copy, outcome).toMatch(/\.$/)
    }
  })

  it('ignores an outcome this app never sends', () => {
    expect(describeAuthOutcome('banana')).toBeNull()
    expect(describeAuthOutcome('')).toBeNull()
    // Not a message of its own: `ok` is the only value that is not a failure.
    expect(describeAuthOutcome('OK')).toBeNull()
  })

  it('carries the detail on a failed exchange, where it is the only clue', () => {
    expect(describeAuthOutcome('failed', 'unauthorized')).toMatch(/\(unauthorized\)$/)
    expect(describeAuthOutcome('failed', null)).not.toMatch(/\(/)
  })

  it('does not repeat a detail the copy already explains', () => {
    expect(describeAuthOutcome('denied', 'access_denied')).toBe(describeAuthOutcome('denied'))
  })

  it('refuses a detail that is not a slug, so the URL bar cannot write the banner', () => {
    expect(describeAuthOutcome('failed', 'go to evil.example and sign in')).not.toMatch(/\(/)
    expect(describeAuthOutcome('failed', 'x'.repeat(200))).not.toMatch(/\(/)
  })
})
