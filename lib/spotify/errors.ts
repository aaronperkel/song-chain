/**
 * Typed failures from the Spotify Web API.
 *
 * Rate limiting is a soft error on purpose: `Retry-After` is a real
 * instruction from Spotify, and a car full of people hammering search will
 * hit it. Callers surface it rather than retrying blindly.
 */
export type SpotifyErrorKind =
  | 'rate-limited'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'no-active-device'
  | 'bad-response'
  | 'network'
  | 'misconfigured'

export class SpotifyError extends Error {
  readonly kind: SpotifyErrorKind
  readonly status: number
  /** Seconds to wait, from the `Retry-After` header. */
  readonly retryAfterSeconds: number | null

  constructor(
    kind: SpotifyErrorKind,
    message: string,
    options: { status?: number; retryAfterSeconds?: number | null; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'SpotifyError'
    this.kind = kind
    this.status = options.status ?? 0
    this.retryAfterSeconds = options.retryAfterSeconds ?? null
  }
}

export function isSpotifyError(error: unknown): error is SpotifyError {
  return error instanceof SpotifyError
}

function parseRetryAfter(response: Response): number | null {
  const header = response.headers.get('retry-after')
  if (header === null) return null
  const seconds = Number.parseInt(header, 10)
  return Number.isFinite(seconds) ? seconds : null
}

/** Map an unsuccessful Spotify response onto a typed error. */
export async function toSpotifyError(response: Response, context: string): Promise<SpotifyError> {
  const body = await response.text().catch(() => '')
  const detail = body.length > 0 ? ` ${body.slice(0, 300)}` : ''

  switch (response.status) {
    case 401:
      return new SpotifyError('unauthorized', `${context}: token rejected.${detail}`, {
        status: 401,
      })
    case 403:
      return new SpotifyError('forbidden', `${context}: not permitted.${detail}`, { status: 403 })
    case 404:
      // On playback endpoints a 404 means "no active device", not "missing".
      return new SpotifyError('not-found', `${context}: not found.${detail}`, { status: 404 })
    case 429:
      return new SpotifyError('rate-limited', `${context}: rate limited.`, {
        status: 429,
        retryAfterSeconds: parseRetryAfter(response),
      })
    default:
      return new SpotifyError(
        'bad-response',
        `${context}: unexpected ${String(response.status)}.${detail}`,
        { status: response.status },
      )
  }
}

/**
 * Parse a response body, treating malformed JSON as a Spotify problem rather
 * than letting a SyntaxError escape the module. A proxy returning an HTML
 * error page is the realistic case.
 */
export async function readJson(response: Response, context: string): Promise<unknown> {
  try {
    return await response.json()
  } catch (cause) {
    throw new SpotifyError('bad-response', `${context}: body was not JSON`, {
      status: response.status,
      cause,
    })
  }
}
