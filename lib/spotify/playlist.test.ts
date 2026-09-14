import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seal } from '@/lib/crypto/seal'
import type { StoredHostTokens } from '@/lib/rooms/repo'

/**
 * Writing the chain into somebody's Spotify library. Two things must hold:
 * the order survives, because the order *is* the game, and nothing is written
 * without the scope having been granted first.
 */
const findHostTokens = vi.fn<(roomId: string) => Promise<StoredHostTokens | null>>()

vi.mock('@/lib/rooms/repo', () => ({
  findHostTokens: (roomId: string) => findHostTokens(roomId),
  saveRefreshedTokens: async () => undefined,
}))

const { addTracksToPlaylist, createPlaylist, hasPlaylistScope, PLAYLIST_ADD_CHUNK, PLAYLIST_SCOPE } =
  await import('./playlist')

const KEY = randomBytes(32).toString('base64')
const fetchMock = vi.fn<typeof fetch>()

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })

beforeEach(() => {
  fetchMock.mockReset()
  findHostTokens.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  // Before seal() below: sealing reads TOKEN_ENC_KEY at call time.
  vi.stubEnv('TOKEN_ENC_KEY', KEY)
  vi.stubEnv('SPOTIFY_CLIENT_ID', 'client-id')
  vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'client-secret')
  findHostTokens.mockResolvedValue({
    refreshTokenSealed: seal('refresh-token'),
    accessTokenSealed: seal('good-access'),
    accessTokenExpiresAt: new Date(Date.now() + 600_000),
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const bodyOf = (index: number): Record<string, unknown> =>
  JSON.parse(String(fetchMock.mock.calls[index]?.[1]?.body)) as Record<string, unknown>

describe('hasPlaylistScope', () => {
  it('finds the scope among the others', () => {
    expect(hasPlaylistScope(`user-read-private ${PLAYLIST_SCOPE} user-read-email`)).toBe(true)
  })

  it('is false when it was never granted', () => {
    expect(hasPlaylistScope('user-read-private user-modify-playback-state')).toBe(false)
  })

  it('is false when nothing is stored at all', () => {
    expect(hasPlaylistScope(null)).toBe(false)
  })

  it('does not match a scope that merely contains the name', () => {
    // playlist-modify-public is a different permission, and matching it would
    // mean claiming write access we were never given.
    expect(hasPlaylistScope('playlist-modify-public')).toBe(false)
  })
})

describe('createPlaylist', () => {
  it('creates it private, under the host as owner', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ id: 'pl-1', external_urls: { spotify: 'https://open.spotify.com/playlist/pl-1' } }),
    )

    const result = await createPlaylist('room-1', {
      userId: 'aaron',
      name: 'Song Chain — KDJPG',
      description: 'a drive',
    })

    expect(result).toEqual({ id: 'pl-1', url: 'https://open.spotify.com/playlist/pl-1' })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/users/aaron/playlists')
    // Somebody's personal library, and a car game is not something to publish
    // on their public profile.
    expect(bodyOf(0).public).toBe(false)
  })

  it('escapes a user id that needs it', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'pl-1' }))

    await createPlaylist('room-1', { userId: 'a b/c', name: 'n', description: 'd' })

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/users/a%20b%2Fc/playlists')
  })

  it('survives a response with no external URL', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'pl-1' }))

    await expect(
      createPlaylist('room-1', { userId: 'aaron', name: 'n', description: 'd' }),
    ).resolves.toEqual({ id: 'pl-1', url: null })
  })

  it('raises the Spotify error when the scope is missing', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 403 }))

    await expect(
      createPlaylist('room-1', { userId: 'aaron', name: 'n', description: 'd' }),
    ).rejects.toMatchObject({ kind: 'forbidden' })
  })
})

describe('addTracksToPlaylist', () => {
  const uris = (count: number): string[] =>
    Array.from({ length: count }, (_, i) => `spotify:track:${String(i).padStart(22, '0')}`)

  it('sends the tracks in one request when they fit', async () => {
    fetchMock.mockResolvedValueOnce(json({ snapshot_id: 's1' }))

    const added = await addTracksToPlaylist('room-1', 'pl-1', uris(3))

    expect(added).toBe(3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bodyOf(0).uris).toHaveLength(3)
  })

  it('chunks at Spotify\'s limit', async () => {
    fetchMock.mockResolvedValue(json({ snapshot_id: 's1' }))

    const added = await addTracksToPlaylist('room-1', 'pl-1', uris(PLAYLIST_ADD_CHUNK + 5))

    expect(added).toBe(PLAYLIST_ADD_CHUNK + 5)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bodyOf(0).uris).toHaveLength(PLAYLIST_ADD_CHUNK)
    expect(bodyOf(1).uris).toHaveLength(5)
  })

  it('preserves chain order across chunks, which is the whole point', async () => {
    fetchMock.mockResolvedValue(json({ snapshot_id: 's1' }))
    const all = uris(PLAYLIST_ADD_CHUNK + 3)

    await addTracksToPlaylist('room-1', 'pl-1', all)

    const sent = [...(bodyOf(0).uris as string[]), ...(bodyOf(1).uris as string[])]
    expect(sent).toEqual(all)
  })

  it('stops at the first failed chunk rather than leaving a silent gap', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ snapshot_id: 's1' }))
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))

    await expect(
      addTracksToPlaylist('room-1', 'pl-1', uris(PLAYLIST_ADD_CHUNK + 1)),
    ).rejects.toMatchObject({ kind: 'bad-response' })
  })

  it('writes nothing for an empty chain', async () => {
    const added = await addTracksToPlaylist('room-1', 'pl-1', [])

    expect(added).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
