import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { appOrigin } from '@/lib/api/origin'
import { currentHostRoomId } from '@/lib/host/session'
import { STATE_COOKIE, VERIFIER_COOKIE, pkceCookieOptions } from '@/lib/host/pkce-cookies'
import { authorizeUrl, createPkcePair, createState, PLAYLIST_SCOPE } from '@/lib/spotify'
import { spotifyCredentials } from '@/lib/spotify'

/**
 * Start the host's Spotify login.
 *
 * The PKCE verifier and the CSRF state are held in short-lived httpOnly
 * cookies rather than a table: they are single-use, they expire in minutes,
 * and keeping them out of the database means a stalled login leaves no row
 * behind to clean up.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const roomId = await currentHostRoomId()
  if (roomId === null) {
    return NextResponse.json(
      { error: 'not-host', message: 'Create a room before connecting Spotify.' },
      { status: 401 },
    )
  }

  let clientId: string
  try {
    clientId = spotifyCredentials().clientId
  } catch {
    return NextResponse.json(
      { error: 'misconfigured', message: 'Spotify is not configured on the server.' },
      { status: 503 },
    )
  }

  const origin = appOrigin(request)

  /**
   * Incremental consent. The first login asks only for what playback needs;
   * write access to somebody's library is requested later, and only if they
   * ask for a playlist. Asking for everything up front is how a consent
   * screen gets declined wholesale.
   */
  const wantsPlaylist = new URL(request.url).searchParams.get('scopes') === 'playlist'

  const { verifier, challenge } = createPkcePair()
  const state = createState()

  const store = await cookies()
  const options = pkceCookieOptions()
  store.set(VERIFIER_COOKIE, verifier, options)
  store.set(STATE_COOKIE, state, options)

  return NextResponse.redirect(
    authorizeUrl({
      clientId,
      origin,
      challenge,
      state,
      extraScopes: wantsPlaylist ? [PLAYLIST_SCOPE] : undefined,
      // Let the host pick the account deliberately, rather than silently
      // reusing whichever one the browser is signed into.
      forceDialog: true,
    }),
  )
}
