import { NextResponse } from 'next/server'
import { z } from 'zod'
import { badRequest } from '@/lib/api/respond'
import { isHostOf } from '@/lib/host/session'
import { broadcastRoomEvent } from '@/lib/realtime/broadcast'
import type { Runway } from '@/lib/realtime/events'
import { removeLastEntry, runway, type StoredEntry } from '@/lib/rooms/chain'
import { findRoomById, setRoomStatus, type RoomStatus } from '@/lib/rooms/repo'
import { clearTurn, readTurn, skipTurn, type TurnState } from '@/lib/rooms/turns'

/**
 * The host's controls: skip, undo, pause, resume, end.
 *
 * All host-only. These are the levers for when the game goes wrong -- someone
 * is asleep, someone picked a song everyone hates, the car is pulling into a
 * petrol station -- and the person holding the phone that plays the music is
 * the one who gets them.
 */
const BodySchema = z.object({
  action: z.enum(['skip', 'undo', 'pause', 'resume', 'end']),
})

export type HostActionResponse = {
  action: z.infer<typeof BodySchema>['action']
  status: RoomStatus
  turn: TurnState
  runway: Runway
  /** The entry undo removed, so the host can see what went. */
  removedEntry?: StoredEntry | null
  /**
   * Set when undo took out a song that was already handed to Spotify.
   * Spotify has no remove-from-queue API, so it will still play.
   */
  queueWarning?: string | null
}

const NO_TURN: TurnState = { currentSeatId: null, turnStartedAt: null }

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params

  if (!(await isHostOf(id))) {
    return NextResponse.json(
      { error: 'not-host', message: 'Only the host can do that.' },
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

  const room = await findRoomById(id)
  if (room === null) {
    return NextResponse.json({ error: 'no-room', message: 'Room not found.' }, { status: 404 })
  }

  const { action } = parsed.data

  // Ending is final. Re-opening a finished game would let a chain everyone
  // has stopped looking at start accepting picks again.
  if (room.status === 'ended' && action !== 'end') {
    return NextResponse.json(
      { error: 'room-ended', message: 'That game has finished.' },
      { status: 409 },
    )
  }

  switch (action) {
    case 'skip': {
      const turn = await skipTurn(id)
      await broadcastRoomEvent(id, { type: 'turn', turn })
      return respond({ action, status: room.status, turn, runway: await runway(id) })
    }

    case 'undo': {
      const removed = await removeLastEntry(id)
      if (removed === null) {
        return NextResponse.json(
          { error: 'nothing-to-undo', message: 'There is nothing in the chain yet.' },
          { status: 409 },
        )
      }

      const [turn, queued] = await Promise.all([readTurn(id), runway(id)])
      await broadcastRoomEvent(id, {
        type: 'undo',
        removedEntryId: removed.id,
        turn: turn ?? NO_TURN,
        runway: queued,
      })

      return respond({
        action,
        status: room.status,
        turn: turn ?? NO_TURN,
        runway: queued,
        removedEntry: removed,
        // Honest rather than reassuring. Spotify has no remove-from-queue
        // API, so the song is out of the chain but still coming out of the
        // speakers, and somebody has to press skip in Spotify itself.
        queueWarning: removed.queuedToSpotify
          ? 'That song is out of the chain, but Spotify was already told to play it. Skip it in Spotify if you do not want to hear it.'
          : null,
      })
    }

    case 'pause':
    case 'resume': {
      const status: RoomStatus = action === 'pause' ? 'paused' : 'playing'
      await setRoomStatus(id, status)
      await broadcastRoomEvent(id, { type: 'room', status, mode: room.mode })

      const [turn, queued] = await Promise.all([readTurn(id), runway(id)])
      return respond({ action, status, turn: turn ?? NO_TURN, runway: queued })
    }

    case 'end': {
      await setRoomStatus(id, 'ended')
      await clearTurn(id)
      await broadcastRoomEvent(id, { type: 'room', status: 'ended', mode: room.mode })
      return respond({ action, status: 'ended', turn: NO_TURN, runway: await runway(id) })
    }
  }
}

function respond(body: HostActionResponse): NextResponse<HostActionResponse> {
  return NextResponse.json(body)
}
