import { NextResponse } from 'next/server'
import { z } from 'zod'
import { badRequest, spotifyErrorResponse } from '@/lib/api/respond'
import { isHostOf } from '@/lib/host/session'
import { broadcastRoomEvent } from '@/lib/realtime/broadcast'
import type { Runway } from '@/lib/realtime/events'
import {
  markPlayed,
  playbackEntries,
  resolvePlayback,
  toPlaybackReading,
} from '@/lib/rooms/playback'
import { findRoomById } from '@/lib/rooms/repo'
import { fetchCurrentlyPlaying, fetchHostQueue } from '@/lib/spotify'

/**
 * Advance the runway from what the host's Spotify is actually playing.
 *
 * Host-only, because it spends the host's token -- and because only the host's
 * phone knows what is coming out of the speakers. It reports; the server
 * decides what that means and tells the room. Every device shows the same
 * runway because exactly one place computes it.
 *
 * The host polls this every ~10s. `reconcile` asks for the more expensive
 * second call to the queue endpoint, which the host sends roughly every fifth
 * poll -- enough to catch a song skipped between polls without doubling the
 * request rate against Spotify for the whole trip.
 */
const BodySchema = z.object({
  reconcile: z.boolean().default(false),
})

export type PlaybackResponse = {
  runway: Runway
  nowPlayingEntryId: string | null
  nowPlayingTrackId: string | null
  progressMs: number
  isPlaying: boolean
  /** Entries this poll moved into the past. Usually empty. */
  playedEntryIds: string[]
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params

  if (!(await isHostOf(id))) {
    return NextResponse.json(
      { error: 'not-host', message: 'Only the host can report playback.' },
      { status: 403 },
    )
  }

  // An empty body is a valid cheap poll, so a missing one is not an error.
  let body: unknown = {}
  try {
    const text = await request.text()
    if (text.length > 0) body = JSON.parse(text)
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
  if (!room.hasHostToken) {
    return NextResponse.json(
      { error: 'no-host-token', message: 'Connect Spotify first.' },
      { status: 409 },
    )
  }
  if (room.mode === 'manual') {
    return NextResponse.json(
      {
        error: 'manual-mode',
        message: 'This room is in manual mode, so there is no Spotify playback to follow.',
      },
      { status: 409 },
    )
  }

  try {
    // Both reads in parallel: the reconcile poll should not cost twice the
    // latency, since it runs while a car is driving through patchy signal.
    const [playback, queue] = await Promise.all([
      fetchCurrentlyPlaying(id),
      parsed.data.reconcile ? fetchHostQueue(id) : Promise.resolve(null),
    ])

    const entries = await playbackEntries(id)
    const resolution = resolvePlayback(entries, toPlaybackReading(playback, queue))
    const { runway, markedIds } = await markPlayed(id, resolution.playedEntryIds)

    // Only when the runway actually moved. A broadcast every ten seconds for
    // the whole trip would be noise on every phone in the car, and the number
    // on screen has not changed.
    if (markedIds.length > 0) {
      await broadcastRoomEvent(id, {
        type: 'playback',
        playedEntryIds: markedIds,
        runway,
        nowPlayingId: resolution.nowPlayingEntryId,
      })
    }

    const response: PlaybackResponse = {
      runway,
      nowPlayingEntryId: resolution.nowPlayingEntryId,
      nowPlayingTrackId: playback.trackId,
      progressMs: playback.progressMs,
      isPlaying: playback.isPlaying,
      playedEntryIds: markedIds,
    }
    return NextResponse.json(response)
  } catch (error) {
    return spotifyErrorResponse(error)
  }
}
