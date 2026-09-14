import { describe, expect, it } from 'vitest'
import { afterEach, vi } from 'vitest'
import { appOrigin, normalizeLoopback } from './origin'

const request = (url: string, headers: Record<string, string> = {}): Request =>
  new Request(url, { headers })

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('appOrigin', () => {
  it('uses the loopback IP, never the localhost spelling Spotify rejects', () => {
    // Next reports request.url as localhost even when the request arrived at
    // 127.0.0.1, which would build a redirect URI Spotify refuses.
    expect(appOrigin(request('http://localhost:3000/api/x'))).toBe('http://127.0.0.1:3000')
    expect(
      appOrigin(request('http://localhost:3000/api/x', { host: 'localhost:3000' })),
    ).toBe('http://127.0.0.1:3000')
  })

  it('prefers the host header the request really carried', () => {
    expect(
      appOrigin(request('http://localhost:3000/api/x', { host: '192.168.1.40:3000' })),
    ).toBe('http://192.168.1.40:3000')
  })

  it('honours forwarded headers from a proxy', () => {
    expect(
      appOrigin(
        request('http://localhost:3000/api/x', {
          'x-forwarded-host': 'song-chain.vercel.app',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toBe('https://song-chain.vercel.app')
  })

  it('lets APP_ORIGIN win, for a fixed registered redirect URI', () => {
    vi.stubEnv('APP_ORIGIN', 'https://songchain.example/')
    expect(appOrigin(request('http://localhost:3000/api/x', { host: 'whatever' }))).toBe(
      'https://songchain.example',
    )
  })

  it('normalises IPv6 loopback too', () => {
    expect(normalizeLoopback('http://[::1]:3000')).toBe('http://127.0.0.1:3000')
  })

  it('leaves a real host alone', () => {
    expect(normalizeLoopback('https://song-chain.vercel.app')).toBe(
      'https://song-chain.vercel.app',
    )
  })
})
