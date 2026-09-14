/**
 * What the host's phone should say after the round trip through Spotify.
 *
 * The callback route has nothing useful to render -- the host is mid-setup on
 * a phone, and a page whose whole body is an error is a dead end -- so it
 * redirects back to the host screen with the outcome in the query string and
 * this turns that into a sentence.
 *
 * Typed so the route and the screen cannot drift: a new outcome with no copy
 * for it fails to compile.
 */
export type AuthOutcome =
  /** Connected. `detail` carries the mode, live or manual. */
  | 'ok'
  /** The host said no on Spotify's consent screen. */
  | 'denied'
  | 'invalid'
  /** The PKCE cookies were gone by the time they came back. */
  | 'expired'
  | 'state-mismatch'
  /** No host cookie, so there was no room to attach the account to. */
  | 'not-host'
  | 'no-refresh-token'
  /** The token exchange or the profile read threw. `detail` is the kind. */
  | 'failed'

const COPY: Record<Exclude<AuthOutcome, 'ok'>, string> = {
  denied: 'Spotify login was cancelled, so nothing was connected.',
  invalid: 'Spotify sent that login back incomplete. Connect again.',
  expired: 'That login took too long and expired. Connect again.',
  'state-mismatch': 'That login did not come back to the phone that started it. Connect again.',
  'not-host': 'This phone is not hosting a room any more, so there was nothing to connect.',
  'no-refresh-token':
    'Spotify granted a connection that would drop out within the hour. Connect again.',
  failed: 'Spotify would not finish the login.',
}

/** Both sources of `detail` are slugs; anything else is somebody typing in the URL bar. */
const DETAIL = /^[a-z0-9_-]{1,40}$/i

function isFailure(value: string): value is Exclude<AuthOutcome, 'ok'> {
  return Object.hasOwn(COPY, value)
}

/**
 * A sentence for the host, or null when there is nothing worth saying: a
 * success explains itself (the connect banner disappears), and an outcome
 * this app never sends is a hand-edited URL, not news.
 */
export function describeAuthOutcome(
  outcome: string | null,
  detail: string | null = null,
): string | null {
  if (outcome === null || !isFailure(outcome)) return null

  const copy = COPY[outcome]
  // The detail is the only clue to why a server-side exchange failed, so it
  // rides along with the one message that has nothing else to offer.
  if (outcome !== 'failed' || detail === null || !DETAIL.test(detail)) return copy
  return `${copy} (${detail})`
}
