import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seal } from '@/lib/crypto/seal'
import type { StoredHostTokens } from '@/lib/rooms/repo'

/**
 * The host's token is the app's only user credential, and the rule is that a
 * token expiring mid-session is invisible to the players. These tests pin the
 * refresh behaviour that makes that true.
 */
const findHostTokens = vi.fn<(roomId: string) => Promise<StoredHostTokens | null>>()
const saveRefreshedTokens = vi.fn<
  (
    roomId: string,
    tokens: {
      accessTokenSealed: string
      accessTokenExpiresAt: Date
      refreshTokenSealed?: string
    },
  ) => Promise<void>
>()

vi.mock('@/lib/rooms/repo', () => ({
  findHostTokens: (roomId: string) => findHostTokens(roomId),
  saveRefreshedTokens: (roomId: string, tokens: never) => saveRefreshedTokens(roomId, tokens),
}))

const {
  getHostAccessToken,
  queueTrack,
  fetchHostProfile,
  fetchCurrentlyPlaying,
  fetchHostQueue,
  resetHostRefreshCache,
} = await import('./host')

const KEY = randomBytes(32).toString('base64')
const fetchMock = vi.fn<typeof fetch>()

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })

const refreshResponse = (over: Record<string, unknown> = {}): Response =>
  json({ access_token: 'fresh-access', token_type: 'Bearer', expires_in: 3600, ...over })

beforeEach(() => {
  resetHostRefreshCache()
  fetchMock.mockReset()
  findHostTokens.mockReset()
  saveRefreshedTokens.mockReset()
  saveRefreshedTokens.mockResolvedValue()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('TOKEN_ENC_KEY', KEY)
  vi.stubEnv('SPOTIFY_CLIENT_ID', 'client-id')
  vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'client-secret')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const inFuture = (ms: number): Date => new Date(Date.now() + ms)

describe('getHostAccessToken', () => {
  it('uses the cached token while it is comfortably valid', async () => {
    findHostTokens.mockResolvedValue({
      refreshTokenSealed: seal('refresh-token'),
      accessTokenSealed: seal('cached-access'),
      accessTokenExpiresAt: inFuture(600_000),
    })

    await expect(getHostAccessToken('room-1')).resolves.toBe('cached-access')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes when the token is inside the expiry margin', async () => {
    // Still valid for 60s, but the margin is 120s: a request starting now
    // could outlive it.
    findHostTokens.mockResolvedValue({
      refreshTokenSealed: seal('refresh-token'),
      accessTokenSealed: seal('nearly-dead'),
      accessTokenExpiresAt: inFuture(60_000),
    })
    fetchMock.mockResolvedValueOnce(refreshResponse())

    await expect(getHostAccessToken('room-1')).resolves.toBe('fresh-access')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refreshes when there is no cached token at all', async () => {
    findHostTokens.mockResolvedValue({
      refreshTokenSealed: seal('refresh-token'),
      accessTokenSealed: null,
      accessTokenExpiresAt: null,
    })
    fetchMock.mockResolvedValueOnce(refreshResponse())

    await expect(getHostAccessToken('room-1')).resolves.toBe('fresh-access')
  })

  it('sends the refresh grant with the stored refresh token', async () => {
    findHostTokens.mockResolvedValue({
      refreshTokenSealed: seal('the-refresh-token'),
      accessTokenSealed: null,
      accessTokenExpiresAt: null,
    })
    fetchMock.mockResolvedValueOnce(refreshResponse())

    await getHostAccessToken('room-1')

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toBe('https://accounts.spotify.com/api/token')
    const body = new URLSearchParams(String(init?.body))
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('the-refresh-token')
  })

  it('stores the refreshed token sealed, never in plaintext', async () => {
    findHostTokens.mockResolvedValue({
      refreshTokenSealed: seal('refresh-token'),
      accessTokenSealed: null,
      accessTokenExpiresAt: null,
    })
    fetchMock.mockResolvedValueOnce(refreshResponse())

    await getHostAccessToken('room-1')

    const saved = saveRefreshedTokens.mock.calls[0]?.[1]
    expect(saved?.accessTokenSealed).toMatch(/^v1\./)
    expect(saved?.accessTokenSealed).not.toContain('fresh-access')
  })

  it('persists a rotated refresh token', async () => {
    // If Spotify rotates the refresh token and we drop it, the *next* refresh
    // fails and the host is silently logged out mid-game.
    findHostTokens.mockResolvedValue({
      refreshTokenSealed: seal('old-refresh'),
      accessTokenSealed: null,
      accessTokenExpiresAt: null,
    })
    fetchMock.mockResolvedValueOnce(refreshResponse({ refresh_token: 'rotated-refresh' }))

    await getHostAccessToken('room-1')

    const saved = saveRefreshedTokens.mock.calls[0]?.[1]
    expect(saved?.refreshTokenSealed).toBeDefined()
    expect(saved?.refreshTokenSealed).not.toContain('rotated-refresh')
  })

  it('leaves the stored refresh token alone when Spotify does not rotate it', async () => {
    findHostTokens.mockResolvedValue({
      refreshTokenSealed: seal('old-refresh'),
      accessTokenSealed: null,
      accessTokenExpiresAt: null,
    })
    fetchMock.mockResolvedValueOnce(refreshResponse())

    await getHostAccessToken('room-1')

    expect(saveRefreshedTokens.mock.calls[0]?.[1].refreshTokenSealed).toBeUndefined()
  })

  it('single-flights concurrent refreshes for one room', async () => {
    // A car full of people submitting at once must not fire five refreshes:
    // Spotify may rotate the token and leave the losers holding a dead one.
    findHostTokens.mockResolvedValue({
      refreshTokenSealed: seal('refresh-token'),
      accessTokenSealed: null,
      accessTokenExpiresAt: null,
    })
    fetchMock.mockImplementation(() => Promise.resolve(refreshResponse()))

    const tokens = await Promise.all([
      getHostAccessToken('room-1'),
      getHostAccessToken('room-1'),
      getHostAccessToken('room-1'),
    ])

    expect(tokens).toEqual(['fresh-access', 'fresh-access', 'fresh-access'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not share a refresh between different rooms', async () => {
    findHostTokens.mockResolvedValue({
      refreshTokenSealed: seal('refresh-token'),
      accessTokenSealed: null,
      accessTokenExpiresAt: null,
    })
    fetchMock.mockImplementation(() => Promise.resolve(refreshResponse()))

    await Promise.all([getHostAccessToken('room-1'), getHostAccessToken('room-2')])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries cleanly after a failed refresh', async () => {
    findHostTokens.mockResolvedValue({
      refreshTokenSealed: seal('refresh-token'),
      accessTokenSealed: null,
      accessTokenExpiresAt: null,
    })
    fetchMock.mockResolvedValueOnce(json({ error: 'invalid_grant' }, { status: 400 }))
    await expect(getHostAccessToken('room-1')).rejects.toMatchObject({ kind: 'bad-request' })

    fetchMock.mockResolvedValueOnce(refreshResponse())
    await expect(getHostAccessToken('room-1')).resolves.toBe('fresh-access')
  })

  it('reports a room with no Spotify connection distinctly', async () => {
    findHostTokens.mockResolvedValue({
      refreshTokenSealed: null,
      accessTokenSealed: null,
      accessTokenExpiresAt: null,
    })
    await expect(getHostAccessToken('room-1')).rejects.toThrow(/no Spotify host connected/)
  })

  it('reports a missing room distinctly', async () => {
    findHostTokens.mockResolvedValue(null)
    await expect(getHostAccessToken('room-1')).rejects.toThrow(/Room not found/)
  })
})

describe('fetchHostProfile', () => {
  it('puts a premium host in live mode', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'u1', display_name: 'Aaron', product: 'premium' }))
    await expect(fetchHostProfile('token')).resolves.toEqual({
      spotifyUserId: 'u1',
      displayName: 'Aaron',
      product: 'premium',
      mode: 'live',
    })
  })

  it('degrades a free host to manual mode instead of failing later', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'u2', display_name: null, product: 'free' }))
    const profile = await fetchHostProfile('token')
    expect(profile.mode).toBe('manual')
  })

  it('treats an unknown product as manual, the safe default', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'u3' }))
    const profile = await fetchHostProfile('token')
    expect(profile.mode).toBe('manual')
    expect(profile.product).toBeNull()
  })
})

describe('queueTrack', () => {
  beforeEach(() => {
    findHostTokens.mockResolvedValue({
      refreshTokenSealed: seal('refresh-token'),
      accessTokenSealed: seal('good-access'),
      accessTokenExpiresAt: inFuture(600_000),
    })
  })

  it('posts the track URI with the host token', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))

    await queueTrack('room-1', 'spotify:track:4IRHwIZHzlHT1FQpRa5RdE')

    const [url, init] = fetchMock.mock.calls[0] ?? []
    const parsed = new URL(String(url))
    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://api.spotify.com/v1/me/player/queue')
    expect(parsed.searchParams.get('uri')).toBe('spotify:track:4IRHwIZHzlHT1FQpRa5RdE')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer good-access')
  })

  it('maps a 404 to no-active-device, which needs different copy', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { status: 404 } }, { status: 404 }))
    await expect(queueTrack('room-1', 'spotify:track:x')).rejects.toMatchObject({
      kind: 'no-active-device',
    })
  })

  it('surfaces a rate limit with Retry-After', async () => {
    fetchMock.mockResolvedValueOnce(
      json({}, { status: 429, headers: { 'retry-after': '5' } }),
    )
    await expect(queueTrack('room-1', 'spotify:track:x')).rejects.toMatchObject({
      kind: 'rate-limited',
      retryAfterSeconds: 5,
    })
  })

  it('surfaces a non-premium refusal as forbidden', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { status: 403 } }, { status: 403 }))
    await expect(queueTrack('room-1', 'spotify:track:x')).rejects.toMatchObject({
      kind: 'forbidden',
    })
  })
})

/**
 * The playback reads run every ten seconds from a phone in a moving car, so
 * their edge cases are not edge cases -- idle players and dropped connections
 * are the normal state of this app, and neither may throw its way onto the
 * host's screen.
 */
describe('fetchCurrentlyPlaying', () => {
  const validToken = (): void => {
    findHostTokens.mockResolvedValue({
      refreshTokenSealed: seal('refresh-token'),
      accessTokenSealed: seal('good-access'),
      accessTokenExpiresAt: inFuture(600_000),
    })
  }

  beforeEach(validToken)

  it('reads the playing track, its progress and whether it is running', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ is_playing: true, progress_ms: 42_000, item: { id: 'track-1', type: 'track' } }),
    )

    await expect(fetchCurrentlyPlaying('room-1')).resolves.toEqual({
      trackId: 'track-1',
      progressMs: 42_000,
      isPlaying: true,
    })
  })

  it('treats 204 as idle rather than an error', async () => {
    // Spotify sends 204 with no body whenever nothing is playing. A polling
    // loop that threw on it would throw between every pair of songs.
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))

    await expect(fetchCurrentlyPlaying('room-1')).resolves.toEqual({
      trackId: null,
      progressMs: 0,
      isPlaying: false,
    })
  })

  it('treats 202 as idle, for a device that is still waking up', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }))

    await expect(fetchCurrentlyPlaying('room-1')).resolves.toEqual({
      trackId: null,
      progressMs: 0,
      isPlaying: false,
    })
  })

  it('ignores a podcast episode, which is not a chain entry', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ is_playing: true, progress_ms: 10, item: { id: 'ep-1', type: 'episode' } }),
    )

    const result = await fetchCurrentlyPlaying('room-1')

    expect(result.trackId).toBeNull()
    // Still playing something, just nothing of ours.
    expect(result.isPlaying).toBe(true)
  })

  it('tolerates a missing item and absent progress', async () => {
    fetchMock.mockResolvedValueOnce(json({ is_playing: false }))

    await expect(fetchCurrentlyPlaying('room-1')).resolves.toEqual({
      trackId: null,
      progressMs: 0,
      isPlaying: false,
    })
  })

  it('reports a dropped connection as a network error, not a crash', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(fetchCurrentlyPlaying('room-1')).rejects.toMatchObject({ kind: 'network' })
  })

  it('raises the Spotify error for a real failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 403 }))

    await expect(fetchCurrentlyPlaying('room-1')).rejects.toMatchObject({ kind: 'forbidden' })
  })
})

describe('fetchHostQueue', () => {
  beforeEach(() => {
    findHostTokens.mockResolvedValue({
      refreshTokenSealed: seal('refresh-token'),
      accessTokenSealed: seal('good-access'),
      accessTokenExpiresAt: inFuture(600_000),
    })
  })

  it('reads what is playing and what is still queued, in order', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        currently_playing: { id: 'now', type: 'track' },
        queue: [
          { id: 'next-1', type: 'track' },
          { id: 'next-2', type: 'track' },
        ],
      }),
    )

    await expect(fetchHostQueue('room-1')).resolves.toEqual({
      currentTrackId: 'now',
      trackIds: ['next-1', 'next-2'],
    })
  })

  it('drops non-tracks and ids Spotify omits', async () => {
    // Local files carry no id; a queued episode is not a chain entry. Keeping
    // either would corrupt the position the runway is measured from.
    fetchMock.mockResolvedValueOnce(
      json({
        currently_playing: null,
        queue: [
          { id: 'keep', type: 'track' },
          { id: 'ep', type: 'episode' },
          { id: null, type: 'track' },
        ],
      }),
    )

    await expect(fetchHostQueue('room-1')).resolves.toEqual({
      currentTrackId: null,
      trackIds: ['keep'],
    })
  })

  it('handles an empty queue', async () => {
    fetchMock.mockResolvedValueOnce(json({ currently_playing: null, queue: [] }))

    await expect(fetchHostQueue('room-1')).resolves.toEqual({
      currentTrackId: null,
      trackIds: [],
    })
  })

  it('treats 204 as nothing queued', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))

    await expect(fetchHostQueue('room-1')).resolves.toEqual({
      currentTrackId: null,
      trackIds: [],
    })
  })
})
