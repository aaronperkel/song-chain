import type { Seat } from './seats'

/**
 * What a screen should say about the turn it is looking at.
 *
 * Both the host's phone and a passenger's ask the same two questions -- is it
 * me, and may I pick for whoever it is -- so they ask them in one place and
 * cannot drift apart. This decides what to draw and nothing else: the server
 * decides who may actually pick, independently, in `authorizePick`.
 *
 * Type-only imports, so this is safe to run in a browser.
 */
export type TurnView =
  /** No seats yet, or the game has not started. */
  | { kind: 'nobody' }
  | { kind: 'yours'; seat: Seat }
  /** Somebody else is up, and they have a phone to do it with. */
  | { kind: 'theirs'; seat: Seat }
  /** Somebody else is up with no phone in their seat, and you can type for them. */
  | { kind: 'for-them'; seat: Seat }

export function turnView(input: {
  seats: readonly Seat[]
  turn: { currentSeatId: string | null }
  you: { seatId: string | null; isHost: boolean }
}): TurnView {
  const seat = input.seats.find((candidate) => candidate.id === input.turn.currentSeatId) ?? null
  if (seat === null) return { kind: 'nobody' }
  if (seat.id === input.you.seatId) return { kind: 'yours', seat }

  // A spectator is left out on purpose. The server refuses their pick, and a
  // search box that always ends in a refusal is worse than no search box.
  if (!seat.hasPhone && (input.you.seatId !== null || input.you.isHost)) {
    return { kind: 'for-them', seat }
  }

  return { kind: 'theirs', seat }
}
