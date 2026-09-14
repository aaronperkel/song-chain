import { NextResponse } from 'next/server'
import { z } from 'zod'
import { badRequest, spotifyErrorResponse } from '@/lib/api/respond'
import { isHostOf } from '@/lib/host/session'
import { findRoomById } from '@/lib/rooms/repo'
import { queueTrack } from '@/lib/spotify'

/**
 * Push a track to the host's Spotify queue.
 *
 * Host-only, because it spends the host's Spotify token. The room's mode is
 * authoritative: a manual-mode room never reaches Spotify at all, so a
 * non-Premium host gets a clear answer instead of a 403 from the queue API.
 */
const BodySchema = z.object({
  // Only a track URI. Accepting an arbitrary URI would let a caller queue
  // episodes or ads through the host's account.
  uri: z
    .string()
    .regex(/^spotify:track:[A-Za-z0-9]{22}$/, 'uri must be a spotify:track:... URI'),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params

  if (!(await isHostOf(id))) {
    return NextResponse.json(
      { error: 'not-host', message: 'Only the host can queue tracks.' },
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
        message: 'This room is in manual mode, so nothing is pushed to Spotify.',
      },
      { status: 409 },
    )
  }

  try {
    await queueTrack(id, parsed.data.uri)
    return NextResponse.json({ queued: true, uri: parsed.data.uri })
  } catch (error) {
    return spotifyErrorResponse(error)
  }
}
