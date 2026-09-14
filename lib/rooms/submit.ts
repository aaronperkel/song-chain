import { explain, validate, type Explanation, type MatchResult } from '@/lib/rules'
import { isSpotifyError, queueTrack, type AppTrack } from '@/lib/spotify'
import { broadcastRoomEvent } from '@/lib/realtime/broadcast'
import {
  appendPick,
  findEntryByNonce,
  lastEntry,
  listChain,
  runway,
  toRulesHistory,
  toRulesTrack,
  type StoredEntry,
} from './chain'
import type { Room } from './repo'

/**
 * Submitting a pick.
 *
 * The server is authoritative about every part of this: whose turn it is,
 * whether the word actually links, and what the track's metadata says. The
 * client's opinion is a UI convenience only.
 */
export type SubmitOutcome =
  | {
      ok: true
      entry: StoredEntry
      turn: { currentSeatId: string | null; turnStartedAt: string | null }
      wasDuplicate: boolean
      /** Set when the pick was accepted but Spotify would not take it. */
      queueWarning: string | null
    }
  | {
      ok: false
      reason: 'rejected'
      result: MatchResult
      explanation: Explanation
    }

export type SubmitInput = {
  room: Room
  track: AppTrack
  seatId: string | null
  clientNonce: string
  /** Host override records the pick even though the rules rejected it. */
  override: boolean
}

export async function submitPick(input: SubmitInput): Promise<SubmitOutcome> {
  const { room, track, seatId, clientNonce, override } = input

  // An earlier attempt that already landed. Answer from the chain rather than
  // re-validating, because the rules may have moved on since -- the pick
  // itself is now history.
  const existing = await findEntryByNonce(room.id, clientNonce)
  if (existing !== null) {
    return {
      ok: true,
      entry: existing,
      turn: await currentTurn(room.id),
      wasDuplicate: true,
      queueWarning: null,
    }
  }

  const chain = await listChain(room.id)
  const previous = chain[chain.length - 1]

  let result: MatchResult
  if (previous === undefined) {
    // No seed yet: nothing to link to, so this becomes the seed.
    result = { valid: true, matchedWord: '', matchedOn: 'title', via: 'exact' }
  } else {
    result = validate(
      toRulesTrack(previous.track),
      toRulesTrack(track),
      toRulesHistory(chain),
      room.settings,
    )
  }

  if (!result.valid && !override) {
    return {
      ok: false,
      reason: 'rejected',
      result,
      explanation:
        previous === undefined
          ? { sharedWords: [] }
          : explain(
              toRulesTrack(previous.track),
              toRulesTrack(track),
              toRulesHistory(chain),
              room.settings,
            ),
    }
  }

  // Push to Spotify *before* recording, so the chain does not claim a song is
  // queued when it is not. A queue failure is not fatal: the pick is still a
  // legitimate move, and manual mode is the documented fallback.
  let queuedToSpotify = false
  let queueWarning: string | null = null

  if (room.mode === 'live') {
    try {
      await queueTrack(room.id, track.uri)
      queuedToSpotify = true
    } catch (error) {
      queueWarning = isSpotifyError(error)
        ? queueWarningFor(error.kind)
        : 'Could not reach Spotify, so this song was not queued.'
      console.error('[submit] queue failed', error)
    }
  }

  const isSeed = previous === undefined
  const appended = await appendPick({
    roomId: room.id,
    track,
    matchedWord: isSeed || !result.valid ? null : result.matchedWord,
    matchedOn: isSeed || !result.valid ? null : result.matchedOn,
    via: isSeed || !result.valid ? null : result.via,
    seatId,
    isSeed,
    wasOverride: override && !result.valid,
    queuedToSpotify,
    clientNonce,
  })

  const queued = await runway(room.id)
  await broadcastRoomEvent(room.id, {
    type: isSeed ? 'seed' : 'pick',
    entry: appended.entry,
    turn: appended.turn,
    runway: queued,
  })

  return {
    ok: true,
    entry: appended.entry,
    turn: appended.turn,
    wasDuplicate: appended.wasDuplicate,
    queueWarning,
  }
}

function queueWarningFor(kind: string): string {
  switch (kind) {
    case 'no-active-device':
      return 'Nothing is playing on Spotify, so this song was not queued. Start playback and it will queue from here.'
    case 'forbidden':
      return 'Spotify refused the queue, which usually means the host is not Premium. Switch the room to manual mode.'
    case 'rate-limited':
      return 'Spotify is rate limiting us, so this song was not queued.'
    default:
      return 'Spotify would not take this song, so it was not queued.'
  }
}

async function currentTurn(
  roomId: string,
): Promise<{ currentSeatId: string | null; turnStartedAt: string | null }> {
  const { readTurn } = await import('./turns')
  return (await readTurn(roomId)) ?? { currentSeatId: null, turnStartedAt: null }
}

/** The song a new pick has to link to. */
export async function previousTrack(roomId: string): Promise<StoredEntry | null> {
  return lastEntry(roomId)
}
