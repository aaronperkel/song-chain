import { cookies } from 'next/headers'
import { hashSecret, newSecret, secretMatches } from '@/lib/crypto/seal'
import { findHostSecretHash } from '@/lib/rooms/repo'

/**
 * Host identity.
 *
 * Whoever holds this cookie controls the room -- skipping turns, overriding
 * rejections, and spending the host's Spotify token. So it is httpOnly (no
 * script can read it), SameSite=Lax (it has to survive the redirect back from
 * Spotify), and only its hash is ever stored.
 */
const COOKIE_NAME = 'sc_host'
const MAX_AGE_SECONDS = 60 * 60 * 12

type HostCookie = {
  roomId: string
  secret: string
}

function encode(value: HostCookie): string {
  return `${value.roomId}.${value.secret}`
}

function decode(raw: string): HostCookie | null {
  const separator = raw.indexOf('.')
  if (separator <= 0) return null
  const roomId = raw.slice(0, separator)
  const secret = raw.slice(separator + 1)
  if (roomId.length === 0 || secret.length === 0) return null
  return { roomId, secret }
}

/** Issue a host secret for a room, returning the hash to store. */
export function newHostCredentials(): { secret: string; hash: string } {
  const secret = newSecret()
  return { secret, hash: hashSecret(secret) }
}

export async function setHostCookie(roomId: string, secret: string): Promise<void> {
  const store = await cookies()
  store.set(COOKIE_NAME, encode({ roomId, secret }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  })
}

export async function clearHostCookie(): Promise<void> {
  const store = await cookies()
  store.delete(COOKIE_NAME)
}

export async function readHostCookie(): Promise<HostCookie | null> {
  const store = await cookies()
  const raw = store.get(COOKIE_NAME)?.value
  return raw === undefined ? null : decode(raw)
}

/**
 * Is the caller the host of this room?
 *
 * Compared against the stored hash in constant time, so a wrong guess leaks
 * nothing. A cookie for a different room is not host authorisation here.
 */
export async function isHostOf(roomId: string): Promise<boolean> {
  const cookie = await readHostCookie()
  if (cookie === null || cookie.roomId !== roomId) return false

  const storedHash = await findHostSecretHash(roomId)
  if (storedHash === null) return false

  return secretMatches(cookie.secret, storedHash)
}

/** The room this browser hosts, if any. */
export async function currentHostRoomId(): Promise<string | null> {
  const cookie = await readHostCookie()
  if (cookie === null) return null
  return (await isHostOf(cookie.roomId)) ? cookie.roomId : null
}
