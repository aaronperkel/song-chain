import { createHash, randomBytes } from 'node:crypto'

/**
 * Authorization Code with PKCE, for the one person who logs in: the host.
 *
 * PKCE rather than a plain code exchange because the verifier never leaves
 * this server, so an intercepted authorization code is useless on its own.
 */
export const HOST_SCOPES = [
  'user-modify-playback-state',
  'user-read-playback-state',
  'user-read-currently-playing',
] as const

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize'

export type PkcePair = {
  verifier: string
  challenge: string
}

export function createPkcePair(): PkcePair {
  // 64 bytes base64url is 86 chars, inside Spotify's 43-128 range.
  const verifier = randomBytes(64).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function createState(): string {
  return randomBytes(16).toString('base64url')
}

/**
 * Spotify requires the redirect URI to match the dashboard entry exactly, and
 * rejects the `localhost` spelling outright -- the loopback IP is required in
 * development.
 */
export function redirectUri(origin: string): string {
  return new URL('/api/auth/spotify/callback', origin).toString()
}

export function authorizeUrl(options: {
  clientId: string
  origin: string
  challenge: string
  state: string
  /** Re-prompt so the host can switch accounts deliberately. */
  forceDialog?: boolean
  extraScopes?: readonly string[]
}): string {
  const scopes = [...HOST_SCOPES, ...(options.extraScopes ?? [])]
  const params = new URLSearchParams({
    client_id: options.clientId,
    response_type: 'code',
    redirect_uri: redirectUri(options.origin),
    code_challenge_method: 'S256',
    code_challenge: options.challenge,
    state: options.state,
    scope: scopes.join(' '),
  })
  if (options.forceDialog === true) params.set('show_dialog', 'true')
  return `${AUTHORIZE_URL}?${params.toString()}`
}
