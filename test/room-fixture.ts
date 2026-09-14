import { hashSecret, newSecret } from '@/lib/crypto/seal'
import { query } from '@/lib/db'
import { createRoom, type Room } from '@/lib/rooms/repo'

/**
 * A real room in the real database, torn down afterwards.
 *
 * Rooms are cheap and cascade-delete their seats and chain entries, so each
 * test gets its own rather than sharing state.
 */
export async function makeRoom(): Promise<{ room: Room; hostSecret: string }> {
  const hostSecret = newSecret()
  const room = await createRoom(hashSecret(hostSecret))
  return { room, hostSecret }
}

export async function dropRoom(roomId: string): Promise<void> {
  await query('delete from rooms where id = $1', [roomId])
}
