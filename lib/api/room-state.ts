import type { RuleSettings } from '@/lib/rules'
import { listChain, runway, type StoredEntry } from '@/lib/rooms/chain'
import { findRoomById, type Room, type RoomMode, type RoomStatus } from '@/lib/rooms/repo'
import { listSeats, type Seat } from '@/lib/rooms/seats'
import { readTurn, type TurnState } from '@/lib/rooms/turns'
import type { Runway } from '@/lib/realtime/events'

/**
 * Everything a device needs to render a room.
 *
 * One shape for the initial load and for recovery after an outage, so a phone
 * coming back from no signal can replace its whole view in a single request
 * rather than stitching together deltas it may have missed.
 *
 * Deliberately excludes anything sealed: no tokens, no secret hashes.
 */
export type RoomState = {
  room: {
    id: string
    code: string
    status: RoomStatus
    mode: RoomMode
    settings: RuleSettings
    hostConnected: boolean
    hostDisplayName: string | null
  }
  seats: Seat[]
  chain: StoredEntry[]
  turn: TurnState
  runway: Runway
  /** Who this request is, so one payload serves host, player and spectator. */
  you: {
    seatId: string | null
    isHost: boolean
    isYourTurn: boolean
  }
}

export async function buildRoomState(
  roomId: string,
  viewer: { seatId: string | null; isHost: boolean },
): Promise<RoomState | null> {
  const room = await findRoomById(roomId)
  if (room === null) return null

  const [seats, chain, turn, queued] = await Promise.all([
    listSeats(roomId),
    listChain(roomId),
    readTurn(roomId),
    runway(roomId),
  ])

  return {
    room: publicRoom(room),
    seats,
    chain,
    turn: turn ?? { currentSeatId: null, turnStartedAt: null },
    runway: queued,
    you: {
      seatId: viewer.seatId,
      isHost: viewer.isHost,
      isYourTurn: viewer.seatId !== null && turn?.currentSeatId === viewer.seatId,
    },
  }
}

export function publicRoom(room: Room): RoomState['room'] {
  return {
    id: room.id,
    code: room.code,
    status: room.status,
    mode: room.mode,
    settings: room.settings,
    hostConnected: room.hasHostToken,
    hostDisplayName: room.hostDisplayName,
  }
}
