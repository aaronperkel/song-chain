import { getAppToken } from './appToken'
import { SpotifyError, readJson, toSpotifyError } from './errors'
import { SpotifySearchResponseSchema, toAppTrack, type AppTrack } from './types'

const SEARCH_URL = 'https://api.spotify.com/v1/search'

/**
 * Spotify's search `limit` is documented as accepting up to 50, but this app
 * gets a 400 "Invalid limit" for anything above 10 -- verified empirically
 * against the live API, one value at a time. Asking for more fails the whole
 * search, so the ceiling here is the real one, not the documented one.
 *
 * Ten results is plenty for a phone in a moving car anyway.
 */
export const SEARCH_LIMIT_MAX = 10
export const SEARCH_LIMIT_DEFAULT = 10

export type SearchOptions = {
  limit?: number
  /** Relevance is market-dependent; also drives `is_playable`. */
  market?: string
}

export async function searchTracks(
  query: string,
  options: SearchOptions = {},
): Promise<AppTrack[]> {
  const trimmed = query.trim()
  if (trimmed.length === 0) return []

  const limit = Math.min(Math.max(options.limit ?? SEARCH_LIMIT_DEFAULT, 1), SEARCH_LIMIT_MAX)
  const params = new URLSearchParams({
    q: trimmed,
    type: 'track',
    limit: String(limit),
    market: options.market ?? 'US',
  })

  const token = await getAppToken()

  let response: Response
  try {
    response = await fetch(`${SEARCH_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
  } catch (cause) {
    throw new SpotifyError('network', 'Could not reach Spotify search', { cause })
  }

  if (!response.ok) throw await toSpotifyError(response, 'Track search')

  const parsed = SpotifySearchResponseSchema.safeParse(await readJson(response, 'Track search'))
  if (!parsed.success) {
    throw new SpotifyError('bad-response', 'Unrecognised search response from Spotify')
  }

  // Spotify pads `items` with nulls for tracks unavailable in the market.
  return parsed.data.tracks.items
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .map(toAppTrack)
}
