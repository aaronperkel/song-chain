import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAppTokenCache } from '@/lib/spotify'
import {
  jsonResponse,
  searchPayload,
  spotifyTrack,
  tokenResponse,
} from '@/lib/spotify/testing'
import { GET } from './route'

const fetchMock = vi.fn<typeof fetch>()

const request = (query: string): Request => new Request(`http://localhost:3000/api/search${query}`)

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
})

describe('GET /api/search', () => {
  it('returns mapped tracks', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse())
    fetchMock.mockResolvedValueOnce(jsonResponse(searchPayload([spotifyTrack()])))

    const response = await GET(request('?q=brightside'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { tracks: Array<{ title: string }> }
    expect(body.tracks[0]?.title).toBe('Mr. Brightside')
  })

  it('rejects a missing query before calling Spotify', async () => {
    const response = await GET(request(''))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'invalid-request',
      message: 'q: a search query is required',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a bad limit', async () => {
    const response = await GET(request('?q=abc&limit=999'))
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a bad market', async () => {
    const response = await GET(request('?q=abc&market=USA'))
    expect(response.status).toBe(400)
  })

  it('passes limit and market through', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse())
    fetchMock.mockResolvedValueOnce(jsonResponse(searchPayload([])))

    await GET(request('?q=abc&limit=5&market=gb'))

    const url = new URL(String(fetchMock.mock.calls[1]?.[0]))
    expect(url.searchParams.get('limit')).toBe('5')
    expect(url.searchParams.get('market')).toBe('GB')
  })

  it('passes a rate limit through with Retry-After', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse())
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { status: 429, headers: { 'retry-after': '9' } }))

    const response = await GET(request('?q=abc'))
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('9')
    expect(await response.json()).toMatchObject({
      error: 'rate-limited',
      retryAfterSeconds: 9,
    })
  })

  it('reports missing server credentials as unavailable, not as a client error', async () => {
    vi.stubEnv('SPOTIFY_CLIENT_SECRET', '')
    const response = await GET(request('?q=abc'))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: 'misconfigured' })
  })

  it('reports a non-JSON body from Spotify as a bad response', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse())
    fetchMock.mockResolvedValueOnce(new Response('<html>502 Bad Gateway</html>', { status: 200 }))

    const response = await GET(request('?q=abc'))
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: 'bad-response' })
  })
})
