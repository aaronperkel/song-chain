'use client'

import type { Connection } from '@/lib/realtime/use-room'
import type { Runway } from '@/lib/realtime/events'

/**
 * The strip every screen carries: which room, how much music is banked, and
 * whether this phone is actually connected.
 *
 * The connection state is shown rather than hidden. In a car it is normal to
 * lose signal, and an interface that quietly stops updating is worse than one
 * that admits it.
 */
export function RoomChrome({
  code,
  runway,
  connection,
  mode,
}: {
  code: string
  runway: Runway
  connection: Connection
  mode: 'live' | 'manual'
}): React.JSX.Element {
  return (
    <header className="border-dusk-line bg-dusk sticky top-0 z-10 flex items-center justify-between gap-3 border-b px-4 py-2">
      <span className="font-display text-paint-dim text-xl tracking-[0.18em]">{code}</span>

      <div className="flex items-center gap-3">
        {mode === 'manual' ? (
          <span className="text-paint-dim text-xs">not playing through Spotify</span>
        ) : null}
        <QueuedForward runway={runway} />
        <ConnectionDot connection={connection} />
      </div>
    </header>
  )
}

/** The runway: how long the car can go before the music runs out. */
function QueuedForward({ runway }: { runway: Runway }): React.JSX.Element {
  const minutes = Math.round(runway.ms / 60_000)

  return (
    <p className="text-right leading-none">
      <span className="font-display text-paint text-2xl">{minutes}</span>
      <span className="text-paint-dim text-sm"> min</span>
      <span className="text-paint-dim block text-xs">
        {runway.songs === 1 ? '1 song' : `${String(runway.songs)} songs`} queued
      </span>
    </p>
  )
}

function ConnectionDot({ connection }: { connection: Connection }): React.JSX.Element {
  const label =
    connection === 'live' ? 'Connected' : connection === 'connecting' ? 'Connecting' : 'No signal'

  return (
    <span className="flex items-center gap-1.5" title={label}>
      <span
        className={[
          'h-2.5 w-2.5 rounded-full',
          connection === 'live'
            ? 'bg-verge'
            : connection === 'connecting'
              ? 'bg-paint-dim'
              : 'bg-brake',
        ].join(' ')}
        aria-hidden
      />
      <span className="sr-only">{label}</span>
      {connection === 'offline' ? (
        <span className="text-brake text-xs">no signal</span>
      ) : null}
    </span>
  )
}
