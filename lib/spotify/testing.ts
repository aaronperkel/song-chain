import { expect, vi } from 'vitest'
import type { SpotifyTrack } from './types'

/** A Spotify search payload, in the shape the API actually returns. */
export function searchPayload(tracks: ReadonlyArray<SpotifyTrack | null>): unknown {
  return { tracks: { items: tracks, total: tracks.length } }
}

export function spotifyTrack(over: Partial<SpotifyTrack> = {}): SpotifyTrack {
  return {
    id: '3n3Ppam7vgaVa1iaRUc9Lp',
    uri: 'spotify:track:3n3Ppam7vgaVa1iaRUc9Lp',
    name: 'Mr. Brightside',
    duration_ms: 222_075,
    explicit: false,
    artists: [{ id: '0C0XlULifJtAgn6ZNCW2eu', name: 'The Killers' }],
    album: {
      id: '4piJq7R3gjUOxnYs6lHtnY',
      name: 'Hot Fuss',
      images: [
        { url: 'https://i.scdn.co/image/large', width: 640, height: 640 },
        { url: 'https://i.scdn.co/image/small', width: 64, height: 64 },
      ],
    },
    ...over,
  }
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

export function tokenResponse(expiresIn = 3600): Response {
  return jsonResponse({
    access_token: 'app-token-abc',
    token_type: 'Bearer',
    expires_in: expiresIn,
  })
}

/** Assert a fetch call hit a URL and return its parsed query string. */
export function calledUrl(mock: ReturnType<typeof vi.fn>, index: number): URL {
  const call = mock.mock.calls[index]
  expect(call).toBeDefined()
  return new URL(String(call?.[0]))
}
