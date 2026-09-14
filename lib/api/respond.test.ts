import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { SpotifyError } from '@/lib/spotify'
import { badRequest, spotifyErrorResponse } from './respond'

describe('badRequest', () => {
  it('names the offending field', async () => {
    const result = z.object({ q: z.string().min(1, 'required') }).safeParse({ q: '' })
    expect(result.success).toBe(false)
    if (result.success) return

    const response = badRequest(result.error)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid-request', message: 'q: required' })
  })
})

describe('spotifyErrorResponse', () => {
  it('maps a rate limit to 429 and echoes Retry-After', async () => {
    const response = spotifyErrorResponse(
      new SpotifyError('rate-limited', 'slow down', { status: 429, retryAfterSeconds: 12 }),
    )
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('12')
    expect(await response.json()).toMatchObject({ retryAfterSeconds: 12 })
  })

  it('maps a missing device to a conflict with actionable copy', async () => {
    const response = spotifyErrorResponse(new SpotifyError('no-active-device', 'none'))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      message: 'No active Spotify device. Open Spotify on the host phone and play something.',
    })
  })

  it('keeps our own credential problems off the client', async () => {
    expect(spotifyErrorResponse(new SpotifyError('unauthorized', 'x')).status).toBe(502)
    expect(spotifyErrorResponse(new SpotifyError('misconfigured', 'x')).status).toBe(503)
  })

  it('re-throws anything that is not a Spotify error, rather than hiding it', () => {
    expect(() => spotifyErrorResponse(new RangeError('bug'))).toThrow(RangeError)
  })
})
