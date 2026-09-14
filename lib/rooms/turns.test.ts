import { describe, expect, it } from 'vitest'
import { turnHasExpired } from './turns'

describe('turnHasExpired', () => {
  const start = '2026-09-14T12:00:00.000Z'
  const at = (seconds: number): number => new Date(start).getTime() + seconds * 1000

  it('never expires when the timer is off', () => {
    expect(turnHasExpired(start, 0, at(9999))).toBe(false)
  })

  it('never expires when no turn has started', () => {
    expect(turnHasExpired(null, 30, at(9999))).toBe(false)
  })

  it('expires only after the full timer has passed', () => {
    expect(turnHasExpired(start, 30, at(29))).toBe(false)
    expect(turnHasExpired(start, 30, at(30))).toBe(false)
    expect(turnHasExpired(start, 30, at(31))).toBe(true)
  })

  it('treats a negative timer as off rather than as instantly expired', () => {
    expect(turnHasExpired(start, -5, at(9999))).toBe(false)
  })
})
