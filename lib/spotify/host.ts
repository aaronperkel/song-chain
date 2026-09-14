import { open, seal } from '@/lib/crypto/seal'
import {
  findHostTokens,
  saveRefreshedTokens,
  type RoomMode,
} from '@/lib/rooms/repo'
import { spotifyCredentials } from './env'
import { SpotifyError, readJson, toSpotifyError } from './errors'
import { redirectUri } from './pkce'
import { SpotifyTokenResponseSchema } from './types'
import { z } from 'zod'

/**
 * The host's Spotify token: the only user credential in the app.
 *
 * It is sealed at rest, refreshed transparently, and never returned to any
 * browser. A token expiring mid-session must be invisible to the players --
 * nobody gets kicked, nobody sees an error, the next queue write just works.
 */
const TOKEN_URL = 'https://accounts.spotify.com/api/token'
const ME_URL = 'https://api.spotify.com/v1/me'
const QUEUE_URL = 'https://api.spotify.com/v1/me/player/queue'

/** Refresh this far ahead of expiry so an in-flight request cannot age out. */
const EXPIRY_MARGIN_MS = 120_000

export type HostTokens = {
  accessToken: string
  expiresAt: Date
  refreshToken: string | null
}

/** Exchange the authorization code from the callback for tokens. */
export async function exchangeCode(options: {
  code: string
  verifier: string
  origin: string
}): Promise<HostTokens & { scope: string }> {
  const { clientId, clientSecret } = spotifyCredentials()

  const response = await postForm(TOKEN_URL, {
    grant_type: 'authorization_code',
    code: options.code,
    redirect_uri: redirectUri(options.origin),
    client_id: clientId,
    code_verifier: options.verifier,
    client_secret: clientSecret,
  })

  if (!response.ok) throw await toSpotifyError(response, 'Authorization code exchange')

  const parsed = SpotifyTokenResponseSchema.safeParse(
    await readJson(response, 'Authorization code exchange'),
  )
  if (!parsed.success) throw new SpotifyError('bad-response', 'Unrecognised token response')

  return {
    accessToken: parsed.data.access_token,
    expiresAt: new Date(Date.now() + parsed.data.expires_in * 1000),
    refreshToken: parsed.data.refresh_token ?? null,
    scope: parsed.data.scope ?? '',
  }
}

/**
 * A valid access token for the room's host, refreshing if needed.
 *
 * Refreshes are single-flighted per room within an instance: a car full of
 * people submitting at once must not fire five refreshes, since Spotify can
 * rotate the refresh token and leave the losers holding a dead one.
 */
const inFlight = new Map<string, Promise<string>>()

export async function getHostAccessToken(roomId: string): Promise<string> {
  const stored = await findHostTokens(roomId)
  if (stored === null) throw new SpotifyError('unauthorized', 'Room not found')
  if (stored.refreshTokenSealed === null) {
    throw new SpotifyError('unauthorized', 'This room has no Spotify host connected')
  }

  const expiresAt = stored.accessTokenExpiresAt
  if (
    stored.accessTokenSealed !== null &&
    expiresAt !== null &&
    expiresAt.getTime() - EXPIRY_MARGIN_MS > Date.now()
  ) {
    return open(stored.accessTokenSealed)
  }

  const existing = inFlight.get(roomId)
  if (existing !== undefined) return existing

  const refreshing = refreshHostToken(roomId, open(stored.refreshTokenSealed)).finally(() => {
    inFlight.delete(roomId)
  })
  inFlight.set(roomId, refreshing)
  return refreshing
}

async function refreshHostToken(roomId: string, refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = spotifyCredentials()

  const response = await postForm(TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  })

  if (!response.ok) throw await toSpotifyError(response, 'Host token refresh')

  const parsed = SpotifyTokenResponseSchema.safeParse(
    await readJson(response, 'Host token refresh'),
  )
  if (!parsed.success) throw new SpotifyError('bad-response', 'Unrecognised refresh response')

  const expiresAt = new Date(Date.now() + parsed.data.expires_in * 1000)
  await saveRefreshedTokens(roomId, {
    accessTokenSealed: seal(parsed.data.access_token),
    accessTokenExpiresAt: expiresAt,
    // Spotify may rotate the refresh token; if it does, the new one must be
    // stored or the next refresh fails.
    ...(parsed.data.refresh_token === undefined
      ? {}
      : { refreshTokenSealed: seal(parsed.data.refresh_token) }),
  })

  return parsed.data.access_token
}

const MeSchema = z.object({
  id: z.string(),
  display_name: z.string().nullable().optional(),
  /** 'premium' | 'free' | 'open' -- the queue API needs premium. */
  product: z.string().nullable().optional(),
})

export type HostProfile = {
  spotifyUserId: string
  displayName: string | null
  product: string | null
  /** Live mode pushes to the Spotify queue; manual mode is the fallback. */
  mode: RoomMode
}

/**
 * Who the host is, and whether the queue API is available to them.
 *
 * `product` decides the room's mode automatically: queueing requires Premium,
 * so a free account degrades to manual mode rather than failing at submit time.
 */
export async function fetchHostProfile(accessToken: string): Promise<HostProfile> {
  const response = await fetch(ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  if (!response.ok) throw await toSpotifyError(response, 'Host profile')

  const parsed = MeSchema.safeParse(await readJson(response, 'Host profile'))
  if (!parsed.success) throw new SpotifyError('bad-response', 'Unrecognised profile response')

  const product = parsed.data.product ?? null
  return {
    spotifyUserId: parsed.data.id,
    displayName: parsed.data.display_name ?? null,
    product,
    mode: product === 'premium' ? 'live' : 'manual',
  }
}

/**
 * Add a track to the host's Spotify queue.
 *
 * Spotify answers 404 when there is no active device, which is a different
 * problem from a missing track and needs different copy in the UI, so it is
 * mapped to its own error kind.
 */
export async function queueTrack(roomId: string, trackUri: string): Promise<void> {
  const accessToken = await getHostAccessToken(roomId)
  const url = `${QUEUE_URL}?${new URLSearchParams({ uri: trackUri }).toString()}`

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })

  if (response.ok) return

  const error = await toSpotifyError(response, 'Queue track')
  if (error.status === 404) {
    throw new SpotifyError('no-active-device', 'No active Spotify device for the host', {
      status: 404,
    })
  }
  throw error
}

async function postForm(url: string, body: Record<string, string>): Promise<Response> {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
      cache: 'no-store',
    })
  } catch (cause) {
    throw new SpotifyError('network', 'Could not reach Spotify', { cause })
  }
}

/** Test seam. */
export function resetHostRefreshCache(): void {
  inFlight.clear()
}
