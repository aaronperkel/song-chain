import { currentHostRoomId } from '@/lib/host/session'
import { findRoomById } from '@/lib/rooms/repo'
import { HostLab, type LabRoom } from './host-lab'

export const metadata = { title: 'host lab — song chain' }

export default async function HostLabPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<React.JSX.Element> {
  const params = await searchParams
  const first = (value: string | string[] | undefined): string | null =>
    Array.isArray(value) ? (value[0] ?? null) : (value ?? null)

  /**
   * Recover the room from the host cookie on the server.
   *
   * Coming back from Spotify is a full page load, so any room held only in
   * React state is gone -- which left every button that needs a room
   * disabled right after authenticating. The host's phone has to survive a
   * reload anyway; the cookie is the source of truth, not component state.
   */
  const roomId = await currentHostRoomId()
  const room = roomId === null ? null : await findRoomById(roomId)

  const initialRoom: LabRoom | null =
    room === null
      ? null
      : {
          id: room.id,
          code: room.code,
          mode: room.mode,
          status: room.status,
          hasHostToken: room.hasHostToken,
          hostDisplayName: room.hostDisplayName,
          hostProduct: room.hostProduct,
        }

  return (
    <main>
      <HostLab
        initialRoom={initialRoom}
        // Connecting from here now lands on /host, where a real host belongs,
        // so these are only read if you come back to the lab by hand.
        authOutcome={first(params.auth)}
        authDetail={first(params.detail)}
      />
    </main>
  )
}
