import { NextResponse } from 'next/server'
import type { z } from 'zod'
import { isSpotifyError, type SpotifyErrorKind } from '@/lib/spotify'

export type ApiErrorBody = {
  error: string
  message: string
  /** Present on 429, echoing Spotify's own instruction. */
  retryAfterSeconds?: number
}

export function badRequest(error: z.ZodError): NextResponse<ApiErrorBody> {
  const first = error.issues[0]
  const where = first?.path.join('.') ?? 'request'
  return NextResponse.json(
    { error: 'invalid-request', message: `${where}: ${first?.message ?? 'invalid'}` },
    { status: 400 },
  )
}

/** How each Spotify failure should read to a phone in a car. */
const STATUS_BY_KIND: Record<SpotifyErrorKind, { status: number; message: string }> = {
  'bad-request': { status: 502, message: 'Spotify rejected the request we sent.' },
  'rate-limited': { status: 429, message: 'Spotify is rate limiting us. Try again in a moment.' },
  unauthorized: { status: 502, message: 'Spotify rejected our credentials.' },
  forbidden: { status: 502, message: 'Spotify refused that request.' },
  'not-found': { status: 404, message: 'Spotify has nothing for that.' },
  'no-active-device': {
    status: 409,
    message: 'No active Spotify device. Open Spotify on the host phone and play something.',
  },
  'bad-response': { status: 502, message: 'Spotify sent something we did not understand.' },
  network: { status: 504, message: 'Could not reach Spotify.' },
  misconfigured: { status: 503, message: 'Spotify is not configured on the server.' },
}

/**
 * Turn a thrown error into a response. Unknown errors are re-thrown so they
 * reach the platform's error reporting rather than being swallowed as a 500
 * with no detail.
 */
export function spotifyErrorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (!isSpotifyError(error)) throw error

  const mapped = STATUS_BY_KIND[error.kind]
  const headers = new Headers()
  if (error.retryAfterSeconds !== null) {
    headers.set('retry-after', String(error.retryAfterSeconds))
  }

  const body: ApiErrorBody = { error: error.kind, message: mapped.message }
  if (error.retryAfterSeconds !== null) body.retryAfterSeconds = error.retryAfterSeconds

  return NextResponse.json(body, { status: mapped.status, headers })
}
