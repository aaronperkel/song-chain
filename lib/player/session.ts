import { cookies } from 'next/headers'
import { seatMatches } from '@/lib/rooms/seats'

/**
 * A player's seat identity.
 *
 * This cookie is how reconnecting works: a phone that locked, backgrounded,
 * lost signal or reloaded comes back to the same seat instead of joining
 * twice. It is deliberately *not* name-based -- see joinRoom.
 *
 * Scoped per room, so one device can hold seats in different rooms without
 * them overwriting each other.
 */
const MAX_AGE_SECONDS = 60 * 60 * 12

function cookieName(roomId: string): string {
  return `sc_seat_${roomId.replace(/-/g, '')}`
}

type SeatCookie = { seatId: string; secret: string }

function decode(raw: string): SeatCookie | null {
  const separator = raw.indexOf('.')
  if (separator <= 0) return null
  const seatId = raw.slice(0, separator)
  const secret = raw.slice(separator + 1)
  if (seatId.length === 0 || secret.length === 0) return null
  return { seatId, secret }
}

export async function setSeatCookie(
  roomId: string,
  seatId: string,
  secret: string,
): Promise<void> {
  const store = await cookies()
  store.set(cookieName(roomId), `${seatId}.${secret}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  })
}

export async function clearSeatCookie(roomId: string): Promise<void> {
  const store = await cookies()
  store.delete(cookieName(roomId))
}

/**
 * The seat this browser holds in this room, verified against the stored hash.
 *
 * Returns null for a removed seat or a stale cookie, so a player whose seat
 * was taken away is treated as a spectator rather than erroring.
 */
export async function currentSeatId(roomId: string): Promise<string | null> {
  const store = await cookies()
  const raw = store.get(cookieName(roomId))?.value
  if (raw === undefined) return null

  const parsed = decode(raw)
  if (parsed === null) return null

  return (await seatMatches(parsed.seatId, parsed.secret)) ? parsed.seatId : null
}
