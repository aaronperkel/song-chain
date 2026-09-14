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

const { getHostAccessToken, queueTrack, fetchHostProfile, resetHostRefreshCache } = await import(
  './host'
)

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
