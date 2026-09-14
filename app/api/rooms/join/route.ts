import { NextResponse } from 'next/server'
import { z } from 'zod'
import { badRequest } from '@/lib/api/respond'
import { buildRoomState, type RoomState } from '@/lib/api/room-state'
import { isHostOf } from '@/lib/host/session'
import { currentSeatId, setSeatCookie } from '@/lib/player/session'
import { isValidCode } from '@/lib/rooms/codes'
import { findRoomByCode } from '@/lib/rooms/repo'
import { joinRoom, MAX_NAME_LENGTH, SeatError } from '@/lib/rooms/seats'
import { broadcastRoomEvent } from '@/lib/realtime/broadcast'
import { listSeats } from '@/lib/rooms/seats'
import { readTurn } from '@/lib/rooms/turns'

/**
 * Join a room by code.
 *
 * Guests reach the game through this and nothing else: no Spotify account, no
 * login, just a code and a name.
 */
const BodySchema = z.object({
  code: z.string().min(1, 'a join code is required'),
  name: z.string().trim().min(1, 'a name is required').max(MAX_NAME_LENGTH),
})

export async function POST(
  request: Request,
): Promise<NextResponse<RoomState | { error: string; message: string }>> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid-request', message: 'Expected a JSON body.' },
      { status: 400 },
    )
  }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) return badRequest(parsed.error)

  if (!isValidCode(parsed.data.code)) {
    return NextResponse.json(
      { error: 'bad-code', message: 'That does not look like a join code.' },
      { status: 400 },
    )
  }

  const room = await findRoomByCode(parsed.data.code)
  if (room === null) {
    return NextResponse.json(
      { error: 'no-room', message: 'No room with that code. Check the letters and try again.' },
      { status: 404 },
    )
  }
  if (room.status === 'ended') {
    return NextResponse.json(
      { error: 'room-ended', message: 'That game has finished.' },
      { status: 409 },
    )
  }

  // Already holding a seat here: rejoin it rather than taking a second one.
  // This is the reconnect path, and it has to come before any insert.
  const existingSeatId = await currentSeatId(room.id)
  if (existingSeatId !== null) {
    const state = await buildRoomState(room.id, {
      seatId: existingSeatId,
      isHost: await isHostOf(room.id),
    })
    if (state !== null) return NextResponse.json(state)
  }

  try {
    const { seat, secret } = await joinRoom(room.id, parsed.data.name)
    await setSeatCookie(room.id, seat.id, secret)

    const [seats, turn] = await Promise.all([listSeats(room.id), readTurn(room.id)])
    // Tell the room someone arrived, so the host's seat list updates itself.
    await broadcastRoomEvent(room.id, {
      type: 'seats',
      seats,
      turn: turn ?? { currentSeatId: null, turnStartedAt: null },
    })

    const state = await buildRoomState(room.id, {
      seatId: seat.id,
      isHost: await isHostOf(room.id),
    })
    if (state === null) {
      return NextResponse.json(
        { error: 'no-room', message: 'Room disappeared while joining.' },
        { status: 404 },
      )
    }
    return NextResponse.json(state, { status: 201 })
  } catch (error) {
    if (error instanceof SeatError && error.code === 'room-full') {
      return NextResponse.json({ error: 'room-full', message: error.message }, { status: 409 })
    }
    console.error('[rooms] join failed', error)
    return NextResponse.json(
      { error: 'join-failed', message: 'Could not join that room.' },
      { status: 503 },
    )
  }
}
