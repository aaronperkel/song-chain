import Link from 'next/link'
import { buildRoomState } from '@/lib/api/room-state'
import { isHostOf } from '@/lib/host/session'
import { currentSeatId } from '@/lib/player/session'
import { findRoomByCode } from '@/lib/rooms/repo'
import { RoomView } from './room-view'

export const metadata = { title: 'Song Chain' }

/**
 * Rendered on the server with the room already in place, so a passenger
 * opening the link sees the chain immediately rather than a spinner. The
 * realtime subscription takes over from there.
 */
export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>
}): Promise<React.JSX.Element> {
  const { code } = await params
  const room = await findRoomByCode(code)

  if (room === null) {
    return (
      <main className="mx-auto w-full max-w-md flex-1 px-5 py-10">
        <h1 className="font-display text-paint text-call uppercase">No such game</h1>
        <p className="text-paint-dim mt-2 text-base">
          That code does not match a game. Codes are five characters, and they expire when the game
          ends.
        </p>
        <Link
          href="/join"
          className="bg-sodium text-dusk font-display mt-8 inline-flex rounded-lg px-5 py-3 text-xl uppercase"
        >
          Try another code
        </Link>
      </main>
    )
  }

  const [seatId, isHost] = await Promise.all([currentSeatId(room.id), isHostOf(room.id)])
  const state = await buildRoomState(room.id, { seatId, isHost })

  if (state === null) {
    return (
      <main className="mx-auto w-full max-w-md flex-1 px-5 py-10">
        <h1 className="font-display text-paint text-call uppercase">Game not found</h1>
      </main>
    )
  }

  if (seatId === null && !isHost) {
    return (
      <main className="mx-auto w-full max-w-md flex-1 px-5 py-10">
        <h1 className="font-display text-paint text-call uppercase">Take a seat first</h1>
        <p className="text-paint-dim mt-2 text-base">
          You are looking at game {room.code} but you have not joined it yet.
        </p>
        <Link
          href={`/join?code=${room.code}`}
          className="bg-sodium text-dusk font-display mt-8 inline-flex rounded-lg px-5 py-3 text-xl uppercase"
        >
          Join this game
        </Link>
      </main>
    )
  }

  return <RoomView initial={state} />
}
