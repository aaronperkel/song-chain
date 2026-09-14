import { SpotifyError } from './errors'

/**
 * Server-only Spotify configuration.
 *
 * Read lazily rather than at module load so the rules engine, tests and the
 * rest of the app keep working without credentials present.
 */
export type SpotifyCredentials = {
  clientId: string
  clientSecret: string
}

export function spotifyCredentials(): SpotifyCredentials {
  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET

  if (clientId === undefined || clientId.length === 0) {
    throw new SpotifyError('misconfigured', 'SPOTIFY_CLIENT_ID is not set')
  }
  if (clientSecret === undefined || clientSecret.length === 0) {
    throw new SpotifyError('misconfigured', 'SPOTIFY_CLIENT_SECRET is not set')
  }

  return { clientId, clientSecret }
}

export function hasSpotifyCredentials(): boolean {
  try {
    spotifyCredentials()
    return true
  } catch {
    return false
  }
}
