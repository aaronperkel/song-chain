'use client'

import { useMemo } from 'react'
import { ChainRoute } from '@/components/chain-route'
import { RoomChrome } from '@/components/room-chrome'
import { SubmitBanner } from '@/components/submit-banner'
import type { RoomState } from '@/lib/api/room-state'
import { useSubmit } from '@/lib/player/use-submit'
import { useRoom } from '@/lib/realtime/use-room'
import { toRulesHistory } from '@/lib/rooms/entry'
import { turnView } from '@/lib/rooms/whose-turn'
import { SongSearch } from './song-search'

/**
 * The player's screen.
 *
 * One question dominates it: is it your turn. Everything else -- the route so
 * far, how much music is banked -- sits underneath, because a passenger
 * glancing down needs the answer before they need the detail.
 */
export function RoomView({ initial }: { initial: RoomState }): React.JSX.Element {
  const { state, connection } = useRoom(initial)
  const { state: submitState, submit, override, dismiss } = useSubmit(state.room.id)

  const previous = state.chain[state.chain.length - 1] ?? null
  const history = useMemo(() => toRulesHistory(state.chain), [state.chain])

  const view = turnView(state)
  const yourMove = view.kind === 'yours' || view.kind === 'for-them'
  const waitingToStart = state.chain.length === 0

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <RoomChrome
        code={state.room.code}
        runway={state.runway}
        connection={connection}
        mode={state.room.mode}
      />

      <div className="mx-auto w-full max-w-md flex-1 px-1 pb-8">
        <section className="px-4 pt-5 pb-3">
          {waitingToStart ? (
            <>
              <h1 className="font-display text-paint text-call uppercase">Waiting to start</h1>
              <p className="text-paint-dim mt-1 text-base">
                {state.room.hostDisplayName ?? 'The host'} is choosing the first song.
              </p>
            </>
          ) : view.kind === 'yours' ? (
            <>
              <h1 className="font-display text-sodium text-shout turn-arrives uppercase">
                Your turn
              </h1>
              <p className="text-paint-dim mt-1 text-base">
                Find a song sharing a word with{' '}
                <span className="text-paint">{previous?.track.title}</span>
              </p>
            </>
          ) : view.kind === 'for-them' ? (
            <>
              {/*
                The driver is playing; they just cannot look at a screen. They
                say the song, anyone types it, and the chain still credits
                them. Said plainly, because the alternative is a table full of
                people waiting on somebody who is watching the road.
              */}
              <h1 className="font-display text-sodium text-call turn-arrives uppercase">
                Pick for {view.seat.name}
              </h1>
              <p className="text-paint-dim mt-1 text-base">
                No phone in that seat. Type what they say — first one in counts, and the song is
                still theirs.
              </p>
            </>
          ) : (
            <>
              <h1 className="font-display text-paint text-call uppercase">
                {view.kind === 'nobody' ? 'Nobody is up' : `${view.seat.name} is picking`}
              </h1>
              <p className="text-paint-dim mt-1 text-base">
                {state.you.seatId === null
                  ? 'You are watching this one.'
                  : nextUpLabel(state)}
              </p>
            </>
          )}
        </section>

        {submitState.status !== 'idle' ? (
          <SubmitBanner
            state={submitState}
            onDismiss={dismiss}
            // Only the host, and the server enforces that independently. The
            // button is hidden from everyone else so nobody spends the game
            // asking why their override does nothing.
            onOverride={state.you.isHost ? override : undefined}
          />
        ) : null}

        {yourMove ? (
          <section className="px-4 pb-6">
            <SongSearch
              previous={previous}
              history={history}
              settings={state.room.settings}
              onPick={(track) => {
                // Named explicitly rather than inferred from the turn: the
                // server has to know this is somebody else's song, and by the
                // time a retry goes through the turn may have moved on.
                submit(track, view.kind === 'for-them' ? { forSeatId: view.seat.id } : undefined)
              }}
              disabled={submitState.status === 'sending'}
            />
          </section>
        ) : null}

        <section>
          <h2 className="text-paint-dim border-dusk-line mx-4 border-t pt-4 pb-2 text-base">
            The chain so far
          </h2>
          {/*
            In a manual room nothing reaches Spotify's queue, so opening the
            song yourself is the only way to hear it. A live room leaves the
            links off: it is already playing, and a passenger tapping one
            would hijack the car's music.
          */}
          <ChainRoute chain={state.chain} linkTracks={state.room.mode === 'manual'} />
        </section>
      </div>
    </div>
  )
}

/** How long until this player is up again. */
function nextUpLabel(state: RoomState): string {
  const order = state.seats
  const currentIndex = order.findIndex((seat) => seat.id === state.turn.currentSeatId)
  const yourIndex = order.findIndex((seat) => seat.id === state.you.seatId)
  if (currentIndex < 0 || yourIndex < 0) return 'Waiting for your turn.'

  const away = (yourIndex - currentIndex + order.length) % order.length
  if (away === 1) return 'You are next.'
  return `${String(away)} players before you.`
}
