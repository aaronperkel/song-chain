import { spotifyCredentials } from './env'
import { SpotifyError, readJson, toSpotifyError } from './errors'
import { SpotifyTokenResponseSchema } from './types'

/**
 * App-level access token via the Client Credentials flow.
 *
 * Search deliberately does *not* use the host's user token. Search needs no
 * user scope, so keeping it on an app token means the client secret never
 * leaves the server, guests need no Spotify account at all, and search keeps
 * working while the host's token is mid-refresh.
 */
const TOKEN_URL = 'https://accounts.spotify.com/api/token'

/** Refresh this many ms before expiry, so an in-flight request can't age out. */
const EXPIRY_MARGIN_MS = 60_000

type CachedToken = {
  accessToken: string
  expiresAt: number
}

/**
 * Module-scope cache. Fluid Compute reuses function instances across
 * requests, so this genuinely avoids re-minting a token per search.
 */
let cached: CachedToken | null = null
let inFlight: Promise<string> | null = null

export async function getAppToken(): Promise<string> {
  const now = Date.now()
  if (cached !== null && cached.expiresAt > now) return cached.accessToken

  // Single-flight: a burst of searches on one instance mints one token.
  if (inFlight !== null) return inFlight

  inFlight = mintToken()
    .then((token) => {
      cached = token
      return token.accessToken
    })
    .finally(() => {
      inFlight = null
    })

  return inFlight
}

async function mintToken(): Promise<CachedToken> {
  const { clientId, clientSecret } = spotifyCredentials()
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  let response: Response
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
      cache: 'no-store',
    })
  } catch (cause) {
    throw new SpotifyError('network', 'Could not reach Spotify to mint an app token', { cause })
  }

  if (!response.ok) throw await toSpotifyError(response, 'Client credentials token')

  const parsed = SpotifyTokenResponseSchema.safeParse(
    await readJson(response, 'Client credentials token'),
  )
  if (!parsed.success) {
    throw new SpotifyError('bad-response', 'Unrecognised token response from Spotify')
  }

  return {
    accessToken: parsed.data.access_token,
    expiresAt: Date.now() + parsed.data.expires_in * 1000 - EXPIRY_MARGIN_MS,
  }
}

/** Test seam: drop the cached token. */
export function resetAppTokenCache(): void {
  cached = null
  inFlight = null
}
