import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAppToken, resetAppTokenCache } from './appToken'
import { isSpotifyError } from './errors'
import { jsonResponse, tokenResponse } from './testing'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  resetAppTokenCache()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('SPOTIFY_CLIENT_ID', 'client-id')
  vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'client-secret')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('getAppToken', () => {
  it('mints a token with basic auth and the client credentials grant', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse())

    await expect(getAppToken()).resolves.toBe('app-token-abc')

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toBe('https://accounts.spotify.com/api/token')
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(
      `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`,
    )
    expect(String(init?.body)).toBe('grant_type=client_credentials')
  })

  it('caches the token instead of minting one per search', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse())

    await getAppToken()
    await getAppToken()
    await getAppToken()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('re-mints once the cached token nears expiry', async () => {
    vi.useFakeTimers()
    // 120s life, minus the 60s safety margin, leaves 60s of usable cache.
    fetchMock.mockResolvedValueOnce(tokenResponse(120))
    await getAppToken()

    vi.advanceTimersByTime(59_000)
    await getAppToken()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(2_000)
    fetchMock.mockResolvedValueOnce(tokenResponse(120))
    await getAppToken()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('single-flights a burst of concurrent requests', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse())

    const tokens = await Promise.all([getAppToken(), getAppToken(), getAppToken()])

    expect(tokens).toEqual(['app-token-abc', 'app-token-abc', 'app-token-abc'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries cleanly after a failure rather than caching the error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'nope' }, { status: 500 }))
    await expect(getAppToken()).rejects.toThrow(/unexpected 500/)

    fetchMock.mockResolvedValueOnce(tokenResponse())
    await expect(getAppToken()).resolves.toBe('app-token-abc')
  })

  it('reports missing credentials as a configuration problem', async () => {
    vi.stubEnv('SPOTIFY_CLIENT_ID', '')
    await expect(getAppToken()).rejects.toMatchObject({ kind: 'misconfigured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces a network failure as a typed error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    const error = await getAppToken().catch((cause: unknown) => cause)
    expect(isSpotifyError(error) && error.kind).toBe('network')
  })

  it('rejects a token response it does not recognise', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 42 }))
    await expect(getAppToken()).rejects.toMatchObject({ kind: 'bad-response' })
  })
})
