import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { authorizeUrl, createPkcePair, createState, redirectUri, HOST_SCOPES } from './pkce'

describe('PKCE pair', () => {
  it('derives the challenge as the S256 digest of the verifier', () => {
    const { verifier, challenge } = createPkcePair()
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
  })

  it('produces a verifier inside Spotify’s length range', () => {
    const { verifier } = createPkcePair()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('is different every time', () => {
    const verifiers = new Set(Array.from({ length: 20 }, () => createPkcePair().verifier))
    expect(verifiers.size).toBe(20)
  })

  it('generates unguessable state', () => {
    expect(new Set(Array.from({ length: 20 }, () => createState())).size).toBe(20)
  })
})

describe('redirect URI', () => {
  it('uses the loopback IP form Spotify requires in development', () => {
    expect(redirectUri('http://127.0.0.1:3000')).toBe(
      'http://127.0.0.1:3000/api/auth/spotify/callback',
    )
  })

  it('follows the deployed origin', () => {
    expect(redirectUri('https://song-chain.vercel.app')).toBe(
      'https://song-chain.vercel.app/api/auth/spotify/callback',
    )
  })
})

describe('authorize URL', () => {
  const build = (): URL =>
    new URL(
      authorizeUrl({
        clientId: 'client-id',
        origin: 'http://127.0.0.1:3000',
        challenge: 'challenge-value',
        state: 'state-value',
      }),
    )

  it('targets Spotify’s authorize endpoint', () => {
    const url = build()
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.spotify.com/authorize')
  })

  it('asks for the code flow with S256', () => {
    const params = build().searchParams
    expect(params.get('response_type')).toBe('code')
    expect(params.get('code_challenge_method')).toBe('S256')
    expect(params.get('code_challenge')).toBe('challenge-value')
    expect(params.get('state')).toBe('state-value')
    expect(params.get('client_id')).toBe('client-id')
  })

  it('requests exactly the playback scopes the game needs', () => {
    expect(build().searchParams.get('scope')).toBe(
      'user-modify-playback-state user-read-playback-state user-read-currently-playing',
    )
    // No playlist scope yet: that is only asked for at export time, in step 5.
    expect(HOST_SCOPES).not.toContain('playlist-modify-private')
  })

  it('never leaks the verifier into the URL', () => {
    const { verifier, challenge } = createPkcePair()
    const url = authorizeUrl({
      clientId: 'c',
      origin: 'http://127.0.0.1:3000',
      challenge,
      state: 's',
    })
    expect(url).not.toContain(verifier)
  })

  it('can force the account dialog', () => {
    const url = new URL(
      authorizeUrl({
        clientId: 'c',
        origin: 'http://127.0.0.1:3000',
        challenge: 'x',
        state: 's',
        forceDialog: true,
      }),
    )
    expect(url.searchParams.get('show_dialog')).toBe('true')
  })

  it('can request extra scopes for the playlist export', () => {
    const url = new URL(
      authorizeUrl({
        clientId: 'c',
        origin: 'http://127.0.0.1:3000',
        challenge: 'x',
        state: 's',
        extraScopes: ['playlist-modify-private'],
      }),
    )
    expect(url.searchParams.get('scope')).toContain('playlist-modify-private')
  })
})
