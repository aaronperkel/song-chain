import type { RuleSettings } from '@/lib/rules'
import type { StoredEntry } from '@/lib/rooms/chain'
import type { Seat } from '@/lib/rooms/seats'
import type { RoomMode, RoomStatus } from '@/lib/rooms/repo'
import type { TurnState } from '@/lib/rooms/turns'

/**
 * What the server tells a room.
 *
 * One channel per room, server writes, clients subscribe. Events carry the
 * changed state rather than a "something happened" ping, so a phone that was
 * briefly offline can catch up from the payload instead of immediately
 * re-fetching -- which matters when the connection is a tunnel in the
 * mountains.
 */
export type RoomEvent =
  | { type: 'pick'; entry: StoredEntry; turn: TurnState; runway: Runway }
  | { type: 'seed'; entry: StoredEntry; turn: TurnState; runway: Runway }
  | { type: 'undo'; removedEntryId: string; turn: TurnState; runway: Runway }
  | { type: 'seats'; seats: Seat[]; turn: TurnState }
  | { type: 'turn'; turn: TurnState }
  | { type: 'playback'; playedEntryIds: string[]; runway: Runway; nowPlayingId: string | null }
  | { type: 'room'; status: RoomStatus; mode: RoomMode }
  | { type: 'settings'; settings: RuleSettings }

export type Runway = { ms: number; songs: number }

/** The Realtime topic for a room. Named after the unguessable room UUID. */
export function roomTopic(roomId: string): string {
  return `room:${roomId}`
}

/** Every room event arrives under one event name, discriminated by `type`. */
export const ROOM_EVENT_NAME = 'room-event'
