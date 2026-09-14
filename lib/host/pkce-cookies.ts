/**
 * Cookie names for the in-flight PKCE login, shared by the login and callback
 * routes. A route file may only export handlers and route config, so these
 * cannot live in either one.
 */
export const VERIFIER_COOKIE = 'sc_pkce'
export const STATE_COOKIE = 'sc_state'

/** Single-use and short-lived: a stalled login should expire on its own. */
export const PKCE_COOKIE_MAX_AGE_SECONDS = 600

export function pkceCookieOptions(): {
  httpOnly: true
  sameSite: 'lax'
  secure: boolean
  path: string
  maxAge: number
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    // SameSite=Lax, because the cookie has to survive Spotify's redirect back.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: PKCE_COOKIE_MAX_AGE_SECONDS,
  }
}
