import { NextResponse } from 'next/server'
import { z } from 'zod'
import { badRequest } from '@/lib/api/respond'
import { isHostOf } from '@/lib/host/session'
import { broadcastRoomEvent } from '@/lib/realtime/broadcast'
import {
  listSeats,
  passSeat,
  removeSeat,
  renameSeat,
  reorderSeats,
  shuffleSeats,
  SeatError,
  type Seat,
} from '@/lib/rooms/seats'
import { advanceTurn, readTurn, type TurnState } from '@/lib/rooms/turns'
import { transaction } from '@/lib/db'

/**
 * Host-only seat management: reorder, shuffle, remove, rename, pass.
 *
 * One route with an `action` rather than five endpoints, because every one of
 * them does the same three things afterwards -- re-read the seats, fix the
 * turn if it moved, broadcast.
 */
const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reorder'), seatIds: z.array(z.string().uuid()).min(1) }),
  z.object({ action: z.literal('shuffle') }),
  z.object({ action: z.literal('remove'), seatId: z.string().uuid() }),
  z.object({ action: z.literal('rename'), seatId: z.string().uuid(), name: z.string().trim().min(1) }),
  z.object({ action: z.literal('pass'), seatId: z.string().uuid() }),
])

type SeatsResponse = {
  seats: Seat[]
  turn: TurnState
  /** Only present for `pass`: the one-time secret for the new device. */
  claimSecret?: string
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<SeatsResponse | { error: string; message: string }>> {
  const { id } = await params

  if (!(await isHostOf(id))) {
    return NextResponse.json(
      { error: 'not-host', message: 'Only the host can manage seats.' },
      { status: 403 },
    )
  }

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

  try {
    let claimSecret: string | undefined
    let seats: Seat[]

    switch (parsed.data.action) {
      case 'reorder':
        seats = await reorderSeats(id, parsed.data.seatIds)
        break
      case 'shuffle':
        seats = await shuffleSeats(id)
        break
      case 'remove': {
        const removed = await removeSeat(id, parsed.data.seatId)
        seats = removed.seats
        // Removing the player whose turn it was would otherwise stall the
        // game on a seat that no longer exists.
        if (removed.wasCurrent) {
          await transaction(async (client) => advanceTurn(client, id))
        }
        break
      }
      case 'rename':
        await renameSeat(parsed.data.seatId, parsed.data.name)
        seats = await listSeats(id)
        break
      case 'pass': {
        const passed = await passSeat(id, parsed.data.seatId)
        if (passed === null) {
          return NextResponse.json(
            { error: 'no-seat', message: 'That seat is not in this room.' },
            { status: 404 },
          )
        }
        claimSecret = passed.secret
        seats = await listSeats(id)
        break
      }
    }

    const turn = (await readTurn(id)) ?? { currentSeatId: null, turnStartedAt: null }
    await broadcastRoomEvent(id, { type: 'seats', seats, turn })

    return NextResponse.json(claimSecret === undefined ? { seats, turn } : { seats, turn, claimSecret })
  } catch (error) {
    if (error instanceof SeatError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: 409 })
    }
    console.error('[seats] action failed', error)
    return NextResponse.json(
      { error: 'seats-failed', message: 'Could not update the seats.' },
      { status: 503 },
    )
  }
}
