import { NextResponse } from 'next/server'
import { buildRoomState, type RoomState } from '@/lib/api/room-state'
import { isHostOf } from '@/lib/host/session'
import { currentSeatId } from '@/lib/player/session'
import { touchSeat } from '@/lib/rooms/seats'

/**
 * The whole room, for the initial render and for recovery.
 *
 * A phone coming back from no signal replaces its entire view with this
 * rather than trying to reconstruct the broadcasts it missed.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<RoomState | { error: string; message: string }>> {
  const { id } = await params

  const [seatId, isHost] = await Promise.all([currentSeatId(id), isHostOf(id)])

  const state = await buildRoomState(id, { seatId, isHost })
  if (state === null) {
    return NextResponse.json({ error: 'no-room', message: 'Room not found.' }, { status: 404 })
  }

  // Presence, piggybacked on a request the client already makes.
  if (seatId !== null) await touchSeat(seatId)

  return NextResponse.json(state, {
    // Never cached: whose turn it is changes constantly.
    headers: { 'cache-control': 'no-store' },
  })
}
