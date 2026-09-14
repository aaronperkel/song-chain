/**
 * The origin the browser actually used, for building redirect URIs.
 *
 * This matters more than it looks: Spotify requires the `redirect_uri` to
 * match a dashboard entry *exactly*, and it rejects the `localhost` spelling
 * outright -- only the loopback IP is accepted for local development. Next's
 * `request.url` reports `localhost` even when the request arrived at
 * 127.0.0.1, which silently produces a redirect URI Spotify refuses.
 *
 * Resolution order:
 *   1. APP_ORIGIN, for deployments where the public origin is fixed and must
 *      match what is registered with Spotify.
 *   2. The forwarded/host header the request really carried.
 *   3. request.url, as a last resort.
 *
 * In development the host is normalised to the loopback IP, since that is the
 * only spelling Spotify accepts.
 */
function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

export function appOrigin(request: Request): string {
  const explicit = process.env.APP_ORIGIN
  if (explicit !== undefined && explicit.length > 0) {
    return stripTrailingSlash(explicit)
  }

  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  const fromUrl = new URL(request.url)
  const protocol =
    request.headers.get('x-forwarded-proto') ?? fromUrl.protocol.replace(':', '')

  const origin = host === null ? fromUrl.origin : `${protocol}://${host}`
  return normalizeLoopback(origin)
}

/**
 * `localhost` and `127.0.0.1` are the same machine but not the same string,
 * and Spotify only accepts the second one.
 */
export function normalizeLoopback(origin: string): string {
  const url = new URL(origin)
  if (url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname === '::1') {
    url.hostname = '127.0.0.1'
  }
  return stripTrailingSlash(url.origin)
}
