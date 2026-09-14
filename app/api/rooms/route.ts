import { NextResponse } from 'next/server'
import { newHostCredentials, setHostCookie } from '@/lib/host/session'
import { createRoom } from '@/lib/rooms/repo'

export type CreateRoomResponse = {
  id: string
  code: string
  mode: string
  status: string
}

/**
 * Create a room and become its host.
 *
 * The host secret is issued here and only its hash is stored, so this response
 * plus the cookie are the only places it ever exists.
 */
export async function POST(): Promise<NextResponse<CreateRoomResponse | { error: string; message: string }>> {
  const { secret, hash } = newHostCredentials()

  try {
    const room = await createRoom(hash)
    await setHostCookie(room.id, secret)
    return NextResponse.json(
      { id: room.id, code: room.code, mode: room.mode, status: room.status },
      { status: 201 },
    )
  } catch (error) {
    console.error('[rooms] create failed', error)
    return NextResponse.json(
      { error: 'room-create-failed', message: 'Could not create a room. Try again.' },
      { status: 503 },
    )
  }
}
