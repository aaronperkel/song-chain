import { z } from 'zod'
import { SpotifyError, readJson, toSpotifyError } from './errors'
import { getHostAccessToken } from './host'

/**
 * Writing the chain out as a Spotify playlist.
 *
 * This is manual mode's payoff. A non-Premium host can never queue anything,
 * so without this the chain they spent a drive building exists only as text --
 * the playlist is the version they can actually play again.
 *
 * It needs `playlist-modify-private`, which the original login deliberately
 * does not ask for: requesting write access to someone's library before they
 * have any use for it is how a consent screen gets declined wholesale. The
 * scope is added later, only if they ask for a playlist.
 */
export const PLAYLIST_SCOPE = 'playlist-modify-private'

/** Spotify takes at most this many track URIs per add request. */
export const PLAYLIST_ADD_CHUNK = 100

const API = 'https://api.spotify.com/v1'

const CreatedPlaylistSchema = z.object({
  id: z.string(),
  external_urls: z.object({ spotify: z.string() }).nullish(),
})

export type CreatedPlaylist = {
  id: string
  /** Where to send the host so they can see what they just made. */
  url: string | null
}

/** Does a stored scope string carry playlist write access? */
export function hasPlaylistScope(scopes: string | null): boolean {
  if (scopes === null) return false
  return scopes.split(/\s+/).includes(PLAYLIST_SCOPE)
}

export async function createPlaylist(
  roomId: string,
  options: { userId: string; name: string; description: string },
): Promise<CreatedPlaylist> {
  const response = await postJson(roomId, `${API}/users/${encodeURIComponent(options.userId)}/playlists`, {
    name: options.name,
    description: options.description,
    // Private by default. This is somebody's personal library, and a game
    // played in a car is not something to publish on their profile.
    public: false,
  })

  if (!response.ok) throw await toSpotifyError(response, 'Create playlist')

  const parsed = CreatedPlaylistSchema.safeParse(await readJson(response, 'Create playlist'))
  if (!parsed.success) throw new SpotifyError('bad-response', 'Unrecognised playlist response')

  return { id: parsed.data.id, url: parsed.data.external_urls?.spotify ?? null }
}

/**
 * Add the chain to a playlist, in order.
 *
 * Chunked at Spotify's own limit and sent strictly in sequence: the tracks are
 * appended in the order they arrive, and firing the chunks in parallel would
 * race them into a shuffled chain. The order *is* the game.
 */
export async function addTracksToPlaylist(
  roomId: string,
  playlistId: string,
  uris: readonly string[],
): Promise<number> {
  let added = 0

  for (let i = 0; i < uris.length; i += PLAYLIST_ADD_CHUNK) {
    const chunk = uris.slice(i, i + PLAYLIST_ADD_CHUNK)
    const response = await postJson(roomId, `${API}/playlists/${encodeURIComponent(playlistId)}/tracks`, {
      uris: chunk,
    })

    if (!response.ok) throw await toSpotifyError(response, 'Add tracks to playlist')
    added += chunk.length
  }

  return added
}

async function postJson(roomId: string, url: string, body: unknown): Promise<Response> {
  const accessToken = await getHostAccessToken(roomId)
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
  } catch (cause) {
    throw new SpotifyError('network', 'Could not reach Spotify', { cause })
  }
}
