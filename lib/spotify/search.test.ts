import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAppTokenCache } from './appToken'
import { fetchTrack, searchTracks } from './search'
import { calledUrl, jsonResponse, searchPayload, spotifyTrack, tokenResponse } from './testing'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  resetAppTokenCache()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('SPOTIFY_CLIENT_ID', 'client-id')
  vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'client-secret')
  fetchMock.mockResolvedValueOnce(tokenResponse())
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('searchTracks', () => {
  it('queries the track endpoint with the app token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(searchPayload([spotifyTrack()])))

    const tracks = await searchTracks('mr brightside')

    const url = calledUrl(fetchMock, 1)
    expect(url.origin + url.pathname).toBe('https://api.spotify.com/v1/search')
    expect(url.searchParams.get('q')).toBe('mr brightside')
    expect(url.searchParams.get('type')).toBe('track')
    expect(url.searchParams.get('limit')).toBe('10')
    expect(url.searchParams.get('market')).toBe('US')

    const init = fetchMock.mock.calls[1]?.[1]
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer app-token-abc')
    expect(tracks).toHaveLength(1)
  })

  it('maps a Spotify track onto the app shape, smallest art first', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(searchPayload([spotifyTrack()])))

    const [track] = await searchTracks('mr brightside')

    expect(track).toEqual({
      id: '3n3Ppam7vgaVa1iaRUc9Lp',
      title: 'Mr. Brightside',
      artists: ['The Killers'],
      durationMs: 222_075,
      uri: 'spotify:track:3n3Ppam7vgaVa1iaRUc9Lp',
      albumName: 'Hot Fuss',
      albumArtUrl: 'https://i.scdn.co/image/small',
      explicit: false,
    })
  })

  it('keeps every artist, so titleAndArtist matching has them all', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        searchPayload([
          spotifyTrack({
            artists: [
              { id: '1', name: 'Nicki Minaj' },
              { id: '2', name: 'Ice Spice' },
              { id: '3', name: 'Aqua' },
            ],
          }),
        ]),
      ),
    )

    const [track] = await searchTracks('barbie world')
    expect(track?.artists).toEqual(['Nicki Minaj', 'Ice Spice', 'Aqua'])
  })

  it('drops the nulls Spotify pads unavailable tracks with', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(searchPayload([null, spotifyTrack({ id: 'a' }), null])),
    )

    const tracks = await searchTracks('anything')
    expect(tracks.map((t) => t.id)).toEqual(['a'])
  })

  it('survives a track with no album art', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(searchPayload([spotifyTrack({ album: undefined })])),
    )

    const [track] = await searchTracks('anything')
    expect(track?.albumArtUrl).toBeNull()
    expect(track?.albumName).toBeNull()
  })

  it('does not call Spotify at all for an empty query', async () => {
    fetchMock.mockReset()
    await expect(searchTracks('   ')).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('clamps the limit to what Spotify actually accepts, not what it documents', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(searchPayload([])))
    await searchTracks('anything', { limit: 500 })
    expect(calledUrl(fetchMock, 1).searchParams.get('limit')).toBe('10')
  })

  it('reports a 400 from Spotify as our own bad request', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { status: 400, message: 'Invalid limit' } }, { status: 400 }),
    )
    await expect(searchTracks('anything')).rejects.toMatchObject({ kind: 'bad-request' })
  })

  it('passes a market through', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(searchPayload([])))
    await searchTracks('anything', { market: 'GB' })
    expect(calledUrl(fetchMock, 1).searchParams.get('market')).toBe('GB')
  })

  it('respects Retry-After on a 429', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { status: 429 } }, { status: 429, headers: { 'retry-after': '17' } }),
    )

    await expect(searchTracks('anything')).rejects.toMatchObject({
      kind: 'rate-limited',
      retryAfterSeconds: 17,
    })
  })

  it('reports a rate limit even without the header', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { status: 429 }))
    await expect(searchTracks('anything')).rejects.toMatchObject({
      kind: 'rate-limited',
      retryAfterSeconds: null,
    })
  })

  it('rejects a search response it does not recognise', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ tracks: { items: 'nope' } }))
    await expect(searchTracks('anything')).rejects.toMatchObject({ kind: 'bad-response' })
  })
})

describe('fetchTrack', () => {
  it('looks a track up by id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(spotifyTrack()))

    const track = await fetchTrack('3n3Ppam7vgaVa1iaRUc9Lp')

    const url = calledUrl(fetchMock, 1)
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://api.spotify.com/v1/tracks/3n3Ppam7vgaVa1iaRUc9Lp',
    )
    expect(track?.title).toBe('Mr. Brightside')
  })

  it('returns null for a track that does not exist', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { status: 404 } }, { status: 404 }))
    await expect(fetchTrack('missing')).resolves.toBeNull()
  })

  it('escapes the id rather than interpolating it raw', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(spotifyTrack()))
    await fetchTrack('a/../../b')
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('a%2F..%2F..%2Fb')
  })

  it('surfaces a rate limit', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({}, { status: 429, headers: { 'retry-after': '3' } }),
    )
    await expect(fetchTrack('x')).rejects.toMatchObject({ kind: 'rate-limited' })
  })
})
