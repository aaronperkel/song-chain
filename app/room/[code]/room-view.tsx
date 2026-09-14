'use client'

import { useMemo } from 'react'
import { ChainRoute } from '@/components/chain-route'
import { RoomChrome } from '@/components/room-chrome'
import type { RoomState } from '@/lib/api/room-state'
import { useSubmit } from '@/lib/player/use-submit'
import { useRoom } from '@/lib/realtime/use-room'
import { toRulesHistory } from '@/lib/rooms/entry'
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
  const { state: submitState, submit, dismiss } = useSubmit(state.room.id)

  const previous = state.chain[state.chain.length - 1] ?? null
  const history = useMemo(() => toRulesHistory(state.chain), [state.chain])

  const currentSeat = state.seats.find((seat) => seat.id === state.turn.currentSeatId) ?? null
  const yourTurn = state.you.isYourTurn
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
          ) : yourTurn ? (
            <>
              <h1 className="font-display text-sodium text-shout turn-arrives uppercase">
                Your turn
              </h1>
              <p className="text-paint-dim mt-1 text-base">
                Find a song sharing a word with{' '}
                <span className="text-paint">{previous?.track.title}</span>
              </p>
            </>
          ) : (
            <>
              <h1 className="font-display text-paint text-call uppercase">
                {currentSeat === null ? 'Nobody is up' : `${currentSeat.name} is picking`}
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
          <SubmitBanner state={submitState} onDismiss={dismiss} />
        ) : null}

        {yourTurn ? (
          <section className="px-4 pb-6">
            <SongSearch
              previous={previous}
              history={history}
              settings={state.room.settings}
              onPick={submit}
              disabled={submitState.status === 'sending'}
            />
          </section>
        ) : null}

        <section>
          <h2 className="text-paint-dim border-dusk-line mx-4 border-t pt-4 pb-2 text-base">
            The chain so far
          </h2>
          <ChainRoute chain={state.chain} />
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

function SubmitBanner({
  state,
  onDismiss,
}: {
  state: ReturnType<typeof useSubmit>['state']
  onDismiss: () => void
}): React.JSX.Element | null {
  switch (state.status) {
    case 'idle':
      return null
    case 'sending':
      return (
        <Banner tone="quiet">
          <span>Adding {state.title}</span>
        </Banner>
      )
    case 'queued-offline':
      return (
        <Banner tone="warn">
          <strong className="block text-lg">No signal</strong>
          <span>
            {state.title} is waiting to send. It will go through by itself — keep this screen open.
          </span>
        </Banner>
      )
    case 'done':
      return (
        <Banner tone="good" onDismiss={onDismiss}>
          <strong className="block text-lg">Added {state.entry.track.title}</strong>
          {state.warning !== null ? <span>{state.warning}</span> : null}
        </Banner>
      )
    case 'rejected':
      return (
        <Banner tone="bad" onDismiss={onDismiss}>
          <strong className="block text-lg">{state.title} does not link</strong>
          {state.explanation.blockers?.map((blocker) => (
            <span key={blocker.kind} className="block">
              {blocker.why}
            </span>
          ))}
          {state.explanation.blockers === undefined
            ? state.explanation.sharedWords
                .filter((word) => !word.accepted)
                .map((word) => (
                  <span key={word.word} className="block">
                    {word.why}
                  </span>
                ))
            : null}
          {state.explanation.sharedWords.length === 0 &&
          state.explanation.blockers === undefined ? (
            <span>It shares no word with the last song.</span>
          ) : null}
        </Banner>
      )
    case 'error':
      return (
        <Banner tone="bad" onDismiss={onDismiss}>
          <span>{state.message}</span>
        </Banner>
      )
  }
}

function Banner({
  tone,
  children,
  onDismiss,
}: {
  tone: 'quiet' | 'good' | 'bad' | 'warn'
  children: React.ReactNode
  onDismiss?: () => void
}): React.JSX.Element {
  const border = {
    quiet: 'border-dusk-line',
    good: 'border-verge',
    bad: 'border-brake',
    warn: 'border-sodium',
  }[tone]

  return (
    <div
      className={`bg-dusk-raised mx-4 mb-4 flex items-start gap-3 rounded-lg border ${border} px-4 py-3`}
      role="status"
    >
      <div className="text-paint-dim flex-1 text-sm leading-snug">{children}</div>
      {onDismiss !== undefined ? (
        <button type="button" onClick={onDismiss} className="text-paint-dim -my-2 px-2 text-base">
          Close
        </button>
      ) : null}
    </div>
  )
}
