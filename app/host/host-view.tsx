'use client'

import { useMemo, useState } from 'react'
import { ChainRoute } from '@/components/chain-route'
import { RoomChrome } from '@/components/room-chrome'
import type { RoomState } from '@/lib/api/room-state'
import { useRoom } from '@/lib/realtime/use-room'
import { usePlaybackPoll } from '@/lib/host/use-playback-poll'
import { toRulesHistory } from '@/lib/rooms/entry'
import type { AppTrack } from '@/lib/spotify'
import { SongSearch } from '@/app/room/[code]/song-search'
import { ChainExport } from './chain-export'
import { HostControls } from './host-controls'
import { RoomSettings } from './room-settings'
import { SeatOrder } from './seat-order'

/**
 * The host's screen.
 *
 * It does three jobs in order of when they matter: get people in, choose the
 * first song, then run the game. Sections drop away as they are done, so the
 * screen does not accumulate clutter over a two-hour drive.
 */
export function HostView({
  initial,
  joinPanel,
}: {
  initial: RoomState
  joinPanel: React.ReactNode
}): React.JSX.Element {
  const { state, connection, refresh } = useRoom(initial)
  const [seeding, setSeeding] = useState(false)
  const [seedError, setSeedError] = useState<string | null>(null)

  // Only the host follows Spotify, and only when there is something to
  // follow. The server broadcasts what it learns to everyone else.
  const playback = usePlaybackPoll({
    roomId: state.room.id,
    enabled: state.room.hostConnected && state.room.mode === 'live',
    onAdvance: refresh,
  })

  const history = useMemo(() => toRulesHistory(state.chain), [state.chain])
  const needsSeed = state.chain.length === 0
  const currentSeat = state.seats.find((seat) => seat.id === state.turn.currentSeatId) ?? null

  const setSeed = async (track: AppTrack): Promise<void> => {
    setSeeding(true)
    setSeedError(null)
    try {
      const response = await fetch(`/api/rooms/${state.room.id}/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId: track.id, nonce: `seed:${state.room.id}:${track.id}` }),
      })
      if (!response.ok) {
        const detail: unknown = await response.json()
        setSeedError(
          typeof detail === 'object' && detail !== null && 'message' in detail
            ? String((detail as { message: unknown }).message)
            : 'Could not start with that song.',
        )
      }
    } catch {
      setSeedError('No signal. The song was not set.')
    } finally {
      setSeeding(false)
    }
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <RoomChrome
        code={state.room.code}
        runway={state.runway}
        connection={connection}
        mode={state.room.mode}
      />

      <div className="mx-auto w-full max-w-lg flex-1 pb-10">
        {!state.room.hostConnected ? (
          <section className="px-4 pt-5">
            <div className="border-sodium bg-dusk-raised rounded-lg border px-4 py-3">
              <strong className="text-paint block text-lg">Spotify is not connected</strong>
              <p className="text-paint-dim mt-1 text-sm leading-snug">
                The game works without it, but nothing will play automatically.
              </p>
              <a
                href="/api/auth/spotify/login"
                className="bg-sodium text-dusk font-display mt-3 inline-flex rounded-lg px-4 py-2 text-lg uppercase"
              >
                Connect Spotify
              </a>
            </div>
          </section>
        ) : null}

        {state.room.mode === 'manual' && state.room.hostConnected ? (
          <section className="px-4 pt-5">
            <div className="border-dusk-line bg-dusk-raised rounded-lg border px-4 py-3">
              <strong className="text-paint block text-lg">Manual mode</strong>
              <p className="text-paint-dim mt-1 text-sm leading-snug">
                Songs are collected here but not sent to Spotify, because the queue needs Premium.
                Tap a song in the chain to open it.
              </p>
            </div>
          </section>
        ) : null}

        <section className="pt-5">
          <h2 className="text-paint-dim px-4 pb-2 text-base">Who is playing</h2>
          <SeatOrder
            roomId={state.room.id}
            seats={state.seats}
            currentSeatId={state.turn.currentSeatId}
          />
        </section>

        {needsSeed ? (
          <section className="px-4 pt-7">
            <h2 className="font-display text-paint text-call uppercase">Pick the first song</h2>
            <p className="text-paint-dim mt-1 mb-3 text-base">
              Everything after this has to share a word with it.
            </p>
            <SongSearch
              previous={null}
              history={history}
              settings={state.room.settings}
              onPick={(track) => {
                void setSeed(track)
              }}
              disabled={seeding}
            />
            {seedError !== null ? (
              <p className="text-brake mt-3 text-base" role="alert">
                {seedError}
              </p>
            ) : null}
          </section>
        ) : (
          <section className="px-4 pt-7">
            <h2 className="font-display text-paint text-call uppercase">
              {currentSeat === null ? 'Waiting for players' : `${currentSeat.name} is picking`}
            </h2>
          </section>
        )}

        {playback.stalled ? (
          <section className="px-4 pt-5">
            <p className="text-paint-dim text-sm" role="status">
              Not following Spotify right now — the queue total may be behind.
            </p>
          </section>
        ) : null}

        <section className="pt-7">
          <h2 className="text-paint-dim border-dusk-line mx-4 border-t px-0 pt-4 pb-2 text-base">
            The chain so far
          </h2>
          <ChainRoute
            chain={state.chain}
            nowPlayingId={playback.nowPlayingEntryId}
            linkTracks={state.room.mode === 'manual'}
          />

          <div className="pt-4">
            <ChainExport
              chain={state.chain}
              code={state.room.code}
              roomId={state.room.id}
              hostConnected={state.room.hostConnected}
            />
          </div>
        </section>

        {/*
          Below the chain: needed rarely, and never in a hurry, so they do not
          earn space above the thing everyone is actually looking at.
        */}
        <section className="pt-7">
          <h2 className="text-paint-dim border-dusk-line mx-4 border-t px-0 pt-4 pb-3 text-base">
            If something goes wrong
          </h2>
          <HostControls
            roomId={state.room.id}
            status={state.room.status}
            canUndo={state.chain.length > 0}
            currentSeatName={currentSeat?.name ?? null}
            onDone={() => {
              void refresh()
            }}
          />
        </section>

        {/*
          Folded away by default. The rules matter most before the first song
          and during an argument, and neither is often enough to spend the
          top of a phone screen on for a two-hour drive.
        */}
        <section className="pt-7">
          <details className="px-4">
            <summary className="text-paint-dim cursor-pointer py-2 text-base">
              House rules
            </summary>
            <div className="-mx-4 pt-3">
              <RoomSettings
                roomId={state.room.id}
                settings={state.room.settings}
                onApplied={() => {
                  void refresh()
                }}
              />
            </div>
          </details>
        </section>

        {/*
          Always available, not just in the lobby. Someone joins late, a
          phone dies, a seat gets passed -- the code has to be findable
          without restarting the game. It moves below the chain once play
          starts, since by then it is reference rather than the main event.
        */}
        <div className="pt-7">
          {needsSeed ? (
            joinPanel
          ) : (
            <details className="px-4">
              <summary className="text-paint-dim cursor-pointer py-2 text-base">
                Show the join code
              </summary>
              <div className="-mx-4 pt-2">{joinPanel}</div>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}
