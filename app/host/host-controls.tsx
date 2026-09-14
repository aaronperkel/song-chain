'use client'

import { useState } from 'react'
import type { HostActionResponse } from '@/app/api/rooms/[id]/host/route'
import type { RoomStatus } from '@/lib/rooms/repo'

/**
 * The levers for when the game goes wrong.
 *
 * Someone is asleep, someone picked a song the car hates, you are pulling into
 * a petrol station. These are destructive in a small way, so each says what it
 * will do before it does it rather than after.
 *
 * Undo is the one that needs care: Spotify has no remove-from-queue API, so a
 * song already handed over will still play. The copy says so plainly instead
 * of implying a tidier result than we can deliver.
 */
type Action = 'skip' | 'undo' | 'pause' | 'resume' | 'end'

export function HostControls({
  roomId,
  status,
  canUndo,
  currentSeatName,
  onDone,
}: {
  roomId: string
  status: RoomStatus
  /** Nothing in the chain means nothing to take back. */
  canUndo: boolean
  currentSeatName: string | null
  onDone?: () => void
}): React.JSX.Element {
  const [busy, setBusy] = useState<Action | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmingEnd, setConfirmingEnd] = useState(false)

  const run = async (action: Action): Promise<void> => {
    setBusy(action)
    setError(null)
    setNotice(null)

    try {
      const response = await fetch(`/api/rooms/${roomId}/host`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })

      const detail: unknown = await response.json().catch(() => null)

      if (!response.ok) {
        setError(
          typeof detail === 'object' && detail !== null && 'message' in detail
            ? String((detail as { message: unknown }).message)
            : 'That did not work.',
        )
        return
      }

      const result = detail as HostActionResponse
      if (action === 'undo') {
        const title = result.removedEntry?.track.title ?? 'That song'
        setNotice(
          result.queueWarning !== null && result.queueWarning !== undefined
            ? `Took back ${title}. ${result.queueWarning}`
            : `Took back ${title}.`,
        )
      }

      onDone?.()
    } catch {
      setError('No signal. Nothing changed.')
    } finally {
      setBusy(null)
      setConfirmingEnd(false)
    }
  }

  if (status === 'ended') {
    return (
      <div className="px-4">
        <p className="text-paint-dim text-base">
          This game has finished. The chain above is what you made.
        </p>
      </div>
    )
  }

  const paused = status === 'paused'

  return (
    <div className="px-4">
      {notice !== null ? (
        <p className="text-paint mb-3 text-base leading-snug" role="status">
          {notice}
        </p>
      ) : null}
      {error !== null ? (
        <p className="text-brake mb-3 text-base" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Control
          onClick={() => {
            void run('skip')
          }}
          disabled={busy !== null || paused}
          busy={busy === 'skip'}
        >
          {currentSeatName === null ? 'Skip this turn' : `Skip ${currentSeatName}`}
        </Control>

        <Control
          onClick={() => {
            void run('undo')
          }}
          disabled={busy !== null || !canUndo}
          busy={busy === 'undo'}
        >
          Undo last song
        </Control>

        <Control
          onClick={() => {
            void run(paused ? 'resume' : 'pause')
          }}
          disabled={busy !== null}
          busy={busy === 'pause' || busy === 'resume'}
        >
          {paused ? 'Resume' : 'Pause'}
        </Control>
      </div>

      {paused ? (
        <p className="text-paint-dim mt-3 text-sm">
          Paused. Nobody can add a song until you resume.
        </p>
      ) : null}

      <div className="mt-5">
        {confirmingEnd ? (
          <div className="border-brake rounded-lg border px-3 py-3">
            <p className="text-paint text-base leading-snug">
              End the game for everyone? The chain stays visible, but nobody can add to it
              again.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  void run('end')
                }}
                disabled={busy !== null}
                className="bg-brake text-paint font-display min-h-[44px] rounded-lg px-4 py-2 text-lg uppercase disabled:opacity-60"
              >
                {busy === 'end' ? 'Ending…' : 'End it'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingEnd(false)
                }}
                className="border-dusk-line text-paint-dim min-h-[44px] rounded-lg border px-4 py-2 text-base"
              >
                Keep playing
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setConfirmingEnd(true)
            }}
            className="text-brake min-h-[44px] text-base underline underline-offset-4"
          >
            End the game
          </button>
        )}
      </div>
    </div>
  )
}

function Control({
  onClick,
  disabled,
  busy,
  children,
}: {
  onClick: () => void
  disabled: boolean
  busy: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      // 44px minimum: this is a phone in a moving car, used one-handed.
      className="border-dusk-line text-paint min-h-[44px] rounded-lg border px-4 py-2 text-base disabled:opacity-40"
    >
      {busy ? '…' : children}
    </button>
  )
}
