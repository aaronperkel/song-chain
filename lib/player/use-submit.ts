'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AppTrack } from '@/lib/spotify'
import type { StoredEntry } from '@/lib/rooms/entry'
import type { Explanation } from '@/lib/rules'

/**
 * Submitting a pick from a car.
 *
 * The hard case is not a failed request, it is an *unanswered* one: the pick
 * may have landed. So every attempt carries a nonce that survives retries
 * and a page reload, and the server treats a repeat as the same pick. The
 * worst outcome is a slow confirmation, never a song queued twice.
 */
const STORAGE_KEY = 'song-chain:pending'
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000]

export type Pending = {
  roomId: string
  nonce: string
  trackId: string
  title: string
  attempts: number
}

/** A settled result. Anything unsettled is derived from the pending attempt. */
type Outcome =
  | { status: 'done'; entry: StoredEntry; warning: string | null }
  | { status: 'rejected'; title: string; explanation: Explanation; reason: string | null }
  | { status: 'error'; message: string }

export type SubmitState =
  | { status: 'idle' }
  | { status: 'sending'; title: string }
  | { status: 'queued-offline'; title: string; attempts: number }
  | Outcome

function readPending(roomId: string): Pending | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as Pending
    return parsed.roomId === roomId ? parsed : null
  } catch {
    return null
  }
}

function writePending(pending: Pending | null): void {
  try {
    if (pending === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(pending))
  } catch {
    // Private browsing, or storage full. The in-memory retry still works for
    // this session; only survival across a reload is lost.
  }
}

export function useSubmit(roomId: string): {
  state: SubmitState
  submit: (track: AppTrack) => void
  dismiss: () => void
} {
  const [pending, setPending] = useState<Pending | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  /**
   * Every state update happens after the request settles, never in the same
   * tick as the call. The visible "sending" state is derived from `pending`
   * instead, which keeps this safe to kick off from an effect when resuming
   * work left over from a reload.
   */
  const send = useCallback(
    async (attempt: Pending): Promise<void> => {
      try {
        const response = await fetch(`/api/rooms/${roomId}/picks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackId: attempt.trackId, nonce: attempt.nonce }),
        })
        const body: unknown = await response.json()

        if (response.status === 422) {
          const rejection = body as { explanation: Explanation; reason: string | null }
          writePending(null)
          setPending(null)
          setOutcome({
            status: 'rejected',
            title: attempt.title,
            explanation: rejection.explanation,
            reason: rejection.reason,
          })
          return
        }

        if (!response.ok) {
          const message =
            typeof body === 'object' && body !== null && 'message' in body
              ? String((body as { message: unknown }).message)
              : 'That did not work.'
          writePending(null)
          setPending(null)
          setOutcome({ status: 'error', message })
          return
        }

        const success = body as { entry: StoredEntry; queueWarning: string | null }
        writePending(null)
        setPending(null)
        setOutcome({ status: 'done', entry: success.entry, warning: success.queueWarning })
      } catch {
        // Unanswered rather than refused, so the pick may well have landed.
        // Keep the nonce and retry; the server recognises it either way.
        const next = { ...attempt, attempts: attempt.attempts + 1 }
        writePending(next)
        setPending(next)
        setOutcome(null)
      }
    },
    [roomId],
  )

  const submit = useCallback(
    (track: AppTrack): void => {
      const attempt: Pending = {
        roomId,
        // Stable across every retry of *this* pick, so repeats collapse into
        // one entry however many times the phone sends them.
        nonce: `${roomId}:${track.id}:${crypto.randomUUID()}`,
        trackId: track.id,
        title: track.title,
        attempts: 0,
      }
      writePending(attempt)
      setPending(attempt)
      setOutcome(null)
      void send(attempt)
    },
    [roomId, send],
  )

  // Resume a submit that a reload or a closed tab interrupted. The read has
  // to happen after mount, and `send` touches no state until its request
  // settles, so this starts nothing mid-render.
  useEffect(() => {
    const unfinished = readPending(roomId)
    // `send` touches no state until its request settles, and reading
    // localStorage has to happen after mount. The rule cannot see past the
    // call; resuming interrupted work is exactly what an effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (unfinished !== null) void send(unfinished)
  }, [roomId, send])

  // Back off while offline, and try again the moment signal returns.
  useEffect(() => {
    // attempts === 0 means the first request is still in flight; scheduling a
    // retry here would fire a second one while the first is unanswered.
    if (pending === null || outcome !== null || pending.attempts === 0) return undefined

    const delay = BACKOFF_MS[Math.min(pending.attempts - 1, BACKOFF_MS.length - 1)] ?? 30_000
    const timer = setTimeout(() => {
      void send(pending)
    }, delay)

    const onOnline = (): void => {
      void send(pending)
    }
    window.addEventListener('online', onOnline)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('online', onOnline)
    }
  }, [pending, outcome, send])

  const dismiss = useCallback((): void => {
    setOutcome(null)
  }, [])

  const state: SubmitState =
    outcome ??
    (pending === null
      ? { status: 'idle' }
      : pending.attempts === 0
        ? { status: 'sending', title: pending.title }
        : { status: 'queued-offline', title: pending.title, attempts: pending.attempts })

  return { state, submit, dismiss }
}
