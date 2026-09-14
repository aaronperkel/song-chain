import { NextResponse } from 'next/server'
import { z } from 'zod'
import { badRequest, spotifyErrorResponse } from '@/lib/api/respond'
import { isHostOf } from '@/lib/host/session'
import { currentSeatId } from '@/lib/player/session'
import { listChain } from '@/lib/rooms/chain'
import { findRoomById, setRoomStatus } from '@/lib/rooms/repo'
import { submitPick } from '@/lib/rooms/submit'
import { startTurnAtFirstSeat } from '@/lib/rooms/turns'
import { fetchTrack } from '@/lib/spotify'

/**
 * Set the starting song and begin the game.
 *
 * Host-only, and only once: the seed is the one pick with nothing to link to,
 * so allowing a second would silently re-root the chain.
 */
const BodySchema = z.object({
  trackId: z.string().regex(/^[A-Za-z0-9]{22}$/, 'trackId must be a Spotify track id'),
  nonce: z.string().min(8).max(128),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params

  if (!(await isHostOf(id))) {
    return NextResponse.json(
      { error: 'not-host', message: 'Only the host can pick the starting song.' },
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

  const chain = await listChain(id)
  if (chain.length > 0) {
    return NextResponse.json(
      { error: 'already-seeded', message: 'This room already has a starting song.' },
      { status: 409 },
    )
  }

  try {
    const track = await fetchTrack(parsed.data.trackId)
    if (track === null) {
      return NextResponse.json(
        { error: 'no-track', message: 'Spotify has no track with that id.' },
        { status: 404 },
      )
    }

    const outcome = await submitPick({
      room,
      track,
      seatId: await currentSeatId(id),
      clientNonce: parsed.data.nonce,
      override: false,
    })

    if (!outcome.ok) {
      // The seed depends on no turn, so `turn-moved` cannot reach here; the
      // narrowing is what says so rather than a comment hoping it is true.
      return NextResponse.json(
        {
          error: 'rejected',
          explanation: outcome.reason === 'rejected' ? outcome.explanation : { sharedWords: [] },
        },
        { status: 422 },
      )
    }

    // The seed does not consume a turn: play starts with the first seat.
    const turn = await startTurnAtFirstSeat(id)
    await setRoomStatus(id, 'playing')

    return NextResponse.json({ entry: outcome.entry, turn }, { status: 201 })
  } catch (error) {
    return spotifyErrorResponse(error)
  }
}
