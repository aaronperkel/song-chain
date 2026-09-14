import { turnHasExpired, type TurnState } from './turns'

/**
 * Who is allowed to submit this pick, and whose it counts as.
 *
 * Pure, and separate from the route, because this is the part of the game
 * that gets argued about in a car: whose turn it was, and whether somebody
 * was allowed to speak for somebody else. Every branch is a test rather than
 * a thing you can only find out by driving somewhere.
 */

/** Just enough of a seat to judge a pick against. */
export type PickTarget = {
  id: string
  name: string
  hasPhone: boolean
}

export type PickRequest = {
  /** The seat this browser's cookie holds in this room, if any. */
  callerSeatId: string | null
  isHost: boolean
  wantsOverride: boolean
  /**
   * The seat the pick is *for*, when it is not the caller's own -- the driver
   * saying a song out loud while a passenger types it. Null for an ordinary
   * pick. The route resolves the id, so a seat that is missing, removed or in
   * another room never reaches here.
   */
  forSeat: PickTarget | null
  turn: TurnState
  /** Room setting, in seconds. 0 means no timer. */
  turnTimer: number
  now?: number
}

export type PickAuthorization =
  | {
      ok: true
      /** Who the entry is attributed to. Null for a host with no seat. */
      seatId: string | null
      /** True when somebody picked on another seat's behalf. */
      onBehalf: boolean
      /**
       * The seat the turn must *still* be pointing at when the pick commits,
       * or null when this pick did not depend on the turn at all.
       *
       * Two passengers racing to type for the driver is the designed
       * interaction, not an edge case, so "it was their turn when I checked"
       * has to be re-checked where the song is actually written. Null for a
       * host, for an expired timer, and before the game starts -- those picks
       * were allowed regardless of where the turn was, so moving it changes
       * nothing about them.
       */
      requireTurnAt: string | null
    }
  | { ok: false; status: 403 | 409; error: string; message: string }

export function authorizePick(request: PickRequest): PickAuthorization {
  const { callerSeatId, isHost, wantsOverride, forSeat, turn } = request

  if (wantsOverride && !isHost) {
    return {
      ok: false,
      status: 403,
      error: 'not-host',
      message: 'Only the host can override a rejection.',
    }
  }

  // A spectator has no standing to pick at all, for themselves or anyone else.
  if (callerSeatId === null && !isHost) {
    return { ok: false, status: 403, error: 'no-seat', message: 'Join the room before picking.' }
  }

  if (forSeat !== null) {
    // Someone holding their own phone picks for themselves. Otherwise a
    // passenger could take a turn out from under a player who was mid-search,
    // and the chain would credit it to them.
    if (forSeat.hasPhone) {
      return {
        ok: false,
        status: 409,
        error: 'has-phone',
        message: `${forSeat.name} has their own phone, so they pick for themselves.`,
      }
    }

    /*
      The turn timer is deliberately not consulted here. It exists so a player
      who has fallen asleep cannot stall the car, and a seat with no phone
      cannot stall anything -- the whole room can already pick for it. All an
      expired timer would add is the right to attribute a song to somebody
      whose turn it demonstrably is not.
    */
    if (!isHost && turn.currentSeatId !== forSeat.id) {
      return {
        ok: false,
        status: 409,
        error: 'not-their-turn',
        message: `${forSeat.name} is not picking right now — somebody may have got there first.`,
      }
    }

    // A host picking out of turn deliberately ignores the pointer, so there
    // is nothing for them to lose a race against.
    return {
      ok: true,
      seatId: forSeat.id,
      onBehalf: true,
      requireTurnAt: isHost && turn.currentSeatId !== forSeat.id ? null : forSeat.id,
    }
  }

  // Turn order, enforced server-side. The host may pick out of turn, since
  // they are the one holding the phone that plays the music.
  const expired = turnHasExpired(turn.turnStartedAt, request.turnTimer, request.now)
  if (
    callerSeatId !== null &&
    !isHost &&
    turn.currentSeatId !== null &&
    turn.currentSeatId !== callerSeatId &&
    !expired
  ) {
    return { ok: false, status: 409, error: 'not-your-turn', message: 'It is not your turn yet.' }
  }

  // Same reasoning as above: the expectation is only what the pick relied on.
  // A host, an expired timer and a game with no turn yet all relied on
  // nothing, so they are held to nothing.
  const reliedOnTheTurn = !isHost && !expired && turn.currentSeatId === callerSeatId
  return {
    ok: true,
    seatId: callerSeatId,
    onBehalf: false,
    requireTurnAt: reliedOnTheTurn ? callerSeatId : null,
  }
}
