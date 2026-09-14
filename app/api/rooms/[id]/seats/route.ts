import { NextResponse } from 'next/server'
import { z } from 'zod'
import { badRequest } from '@/lib/api/respond'
import { isHostOf } from '@/lib/host/session'
import { currentSeatId, setSeatCookie } from '@/lib/player/session'
import { broadcastRoomEvent } from '@/lib/realtime/broadcast'
import {
  joinRoom,
  listSeats,
  passSeat,
  removeSeat,
  renameSeat,
  reorderSeats,
  setSeatPhone,
  shuffleSeats,
  MAX_NAME_LENGTH,
  SeatError,
  type Seat,
} from '@/lib/rooms/seats'
import { advanceTurn, readTurn, type TurnState } from '@/lib/rooms/turns'
import { transaction } from '@/lib/db'

/**
 * Host-only seat management: add, reorder, shuffle, remove, rename, pass,
 * and saying whether a seat has a phone.
 *
 * One route with an `action` rather than seven endpoints, because every one of
 * them does the same three things afterwards -- re-read the seats, fix the
 * turn if it moved, broadcast.
 */
const BodySchema = z.discriminatedUnion('action', [
  /**
   * Put somebody in the turn order from the host screen.
   *
   * `hasPhone: true` seats *this* phone -- the host playing as well as
   * hosting, which is the normal case when the host is not the driver. The
   * request is the only device in reach, so there is no other phone it could
   * mean. `false` seats somebody who is not looking at a screen at all.
   */
  z.object({
    action: z.literal('add'),
    name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
    hasPhone: z.boolean(),
  }),
  z.object({ action: z.literal('reorder'), seatIds: z.array(z.string().uuid()).min(1) }),
  z.object({ action: z.literal('shuffle') }),
  z.object({ action: z.literal('remove'), seatId: z.string().uuid() }),
  z.object({ action: z.literal('rename'), seatId: z.string().uuid(), name: z.string().trim().min(1) }),
  z.object({ action: z.literal('pass'), seatId: z.string().uuid() }),
  z.object({ action: z.literal('set-phone'), seatId: z.string().uuid(), hasPhone: z.boolean() }),
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
      case 'add': {
        // Taking a seat twice is a double-tap, not a request for two seats.
        // Without this the host ends up in the order twice and the game waits
        // on a ghost.
        if (parsed.data.hasPhone && (await currentSeatId(id)) !== null) {
          const existing = await listSeats(id)
          const turn = (await readTurn(id)) ?? { currentSeatId: null, turnStartedAt: null }
          return NextResponse.json({ seats: existing, turn })
        }

        const added = await joinRoom(id, parsed.data.name, {
          isHost: parsed.data.hasPhone,
          hasPhone: parsed.data.hasPhone,
        })
        // The secret only means anything if a browser is going to hold it.
        // A seat with no phone keeps its unheld secret, which is the safe
        // direction: nobody can claim it by guessing.
        if (parsed.data.hasPhone) await setSeatCookie(id, added.seat.id, added.secret)
        seats = await listSeats(id)
        break
      }
      case 'set-phone': {
        const updated = await setSeatPhone(id, parsed.data.seatId, parsed.data.hasPhone)
        if (updated === null) {
          return NextResponse.json(
            { error: 'no-seat', message: 'That seat is not in this room.' },
            { status: 404 },
          )
        }
        seats = await listSeats(id)
        break
      }
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
