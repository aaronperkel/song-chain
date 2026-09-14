import Link from 'next/link'
import { JoinPanel } from '@/components/join-panel'
import { appOrigin } from '@/lib/api/origin'
import { buildRoomState } from '@/lib/api/room-state'
import { describeAuthOutcome } from '@/lib/host/auth-outcome'
import { currentHostRoomId } from '@/lib/host/session'
import { currentSeatId } from '@/lib/player/session'
import { findRoomById } from '@/lib/rooms/repo'
import { HostView } from './host-view'
import { headers } from 'next/headers'
import { StartGame } from './start-game'

export const metadata = { title: 'Hosting — Song Chain' }

/**
 * The host screen recovers its room from the host cookie, so a reload, a
 * locked phone or the round trip through Spotify all come back to the same
 * game rather than starting a new one.
 */
export default async function HostPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<React.JSX.Element> {
  const params = await searchParams
  const first = (value: string | string[] | undefined): string | null =>
    Array.isArray(value) ? (value[0] ?? null) : (value ?? null)

  // Coming back from Spotify. Only a failure has anything to say: connecting
  // shows itself, because the connect banner is gone.
  const authNotice = describeAuthOutcome(first(params.auth), first(params.detail))

  const roomId = await currentHostRoomId()

  if (roomId === null) return <StartGame notice={authNotice} />

  const room = await findRoomById(roomId)
  if (room === null) return <StartGame notice={authNotice} />

  // Read before the room rather than alongside it: the host may be playing
  // too, and whether it is their turn is decided from the seat they hold.
  const seatId = await currentSeatId(roomId)
  const state = await buildRoomState(roomId, { seatId, isHost: true })
  if (state === null) return <StartGame notice={authNotice} />

  // Built here so the QR is rendered on the server, and so the join link
  // matches the origin this phone actually used.
  const headerList = await headers()
  const origin = appOrigin(
    new Request('http://placeholder.invalid', { headers: headerList }),
  )
  const joinUrl = `${origin}/join?code=${room.code}`

  return (
    <>
      <HostView
        initial={state}
        authNotice={authNotice}
        joinPanel={<JoinPanel code={room.code} joinUrl={joinUrl} />}
      />
      {state.chain.length > 0 ? (
        <footer className="mx-auto w-full max-w-lg px-4 pb-8">
          <Link href={`/room/${room.code}`} className="text-paint-dim text-base underline">
            Open the player view for this phone
          </Link>
        </footer>
      ) : null}
    </>
  )
}
