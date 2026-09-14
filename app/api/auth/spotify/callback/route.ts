import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { appOrigin } from '@/lib/api/origin'
import { seal } from '@/lib/crypto/seal'
import type { AuthOutcome } from '@/lib/host/auth-outcome'
import { currentHostRoomId } from '@/lib/host/session'
import { STATE_COOKIE, VERIFIER_COOKIE } from '@/lib/host/pkce-cookies'
import { saveHostIdentity } from '@/lib/rooms/repo'
import { exchangeCode, fetchHostProfile, isSpotifyError } from '@/lib/spotify'

/**
 * Finish the host's Spotify login.
 *
 * Redirects back to the host screen with a short outcome in the query string
 * rather than rendering anything: the host is on a phone mid-setup, and a
 * dead-end page with an error body is useless to them.
 *
 * That screen is `/host`. It pointed at the step 3 lab, `/dev/host`, for as
 * long as the lab was the only host screen there was, which landed every real
 * host on a debug page halfway through setting up their game.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url)
  const params = url.searchParams
  // Must match the URI sent at login byte for byte, or the exchange fails.
  const origin = appOrigin(request)
  const store = await cookies()

  const verifier = store.get(VERIFIER_COOKIE)?.value
  const expectedState = store.get(STATE_COOKIE)?.value
  // Single-use: consume them whatever happens next.
  store.delete(VERIFIER_COOKIE)
  store.delete(STATE_COOKIE)

  const back = (outcome: AuthOutcome, detail?: string): NextResponse => {
    const target = new URL('/host', origin)
    target.searchParams.set('auth', outcome)
    if (detail !== undefined) target.searchParams.set('detail', detail)
    return NextResponse.redirect(target)
  }

  const denied = params.get('error')
  if (denied !== null) return back('denied', denied)

  const code = params.get('code')
  const state = params.get('state')

  if (code === null || state === null) return back('invalid')
  if (verifier === undefined || expectedState === undefined) return back('expired')
  if (state !== expectedState) return back('state-mismatch')

  const roomId = await currentHostRoomId()
  if (roomId === null) return back('not-host')

  try {
    const tokens = await exchangeCode({ code, verifier, origin })
    if (tokens.refreshToken === null) {
      // Without a refresh token the connection dies in an hour, which is
      // worse than failing now while the host is still looking at the screen.
      return back('no-refresh-token')
    }

    const profile = await fetchHostProfile(tokens.accessToken)

    await saveHostIdentity(roomId, {
      spotifyUserId: profile.spotifyUserId,
      displayName: profile.displayName,
      product: profile.product,
      scopes: tokens.scope,
      refreshTokenSealed: seal(tokens.refreshToken),
      accessTokenSealed: seal(tokens.accessToken),
      accessTokenExpiresAt: tokens.expiresAt,
      mode: profile.mode,
    })

    return back('ok', profile.mode)
  } catch (error) {
    console.error('[auth] callback failed', error)
    return back('failed', isSpotifyError(error) ? error.kind : 'unknown')
  }
}
