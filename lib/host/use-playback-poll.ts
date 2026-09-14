'use client'

import { useEffect, useRef, useState } from 'react'
import type { PlaybackResponse } from '@/app/api/rooms/[id]/playback/route'

/**
 * The host's phone following Spotify, so the runway moves on its own.
 *
 * Only the host runs this. Everyone else learns the runway from the broadcast
 * the server sends when it changes, which is why the number is the same on
 * every phone in the car rather than five devices each polling Spotify with
 * their own idea of the answer.
 *
 * Nothing here decides what has played. It reports, the server decides.
 */

/** Spotify's own player updates about this often; polling faster buys nothing. */
const POLL_MS = 10_000

/**
 * Ask for the expensive queue read every fifth poll. `currently-playing`
 * cannot see a song that was skipped between two polls -- by the next poll it
 * is gone -- and the queue endpoint can. Once a minute is enough to catch it
 * without doubling our request rate against Spotify for a whole trip.
 */
const RECONCILE_EVERY = 5

/** After a failure, back off rather than hammering a dead connection. */
const BACKOFF_MS = 30_000

export type PlaybackPoll = {
  /** The chain entry playing right now, for highlighting it. */
  nowPlayingEntryId: string | null
  isPlaying: boolean
  /** True once a poll has failed and we are backing off. */
  stalled: boolean
}

export function usePlaybackPoll({
  roomId,
  enabled,
  onAdvance,
}: {
  roomId: string
  /** Live mode with a connected host only. Manual rooms have nothing to poll. */
  enabled: boolean
  /** Called when the server reports the runway moved, to refresh local state. */
  onAdvance?: () => void
}): PlaybackPoll {
  const [poll, setPoll] = useState<PlaybackPoll>({
    nowPlayingEntryId: null,
    isPlaying: false,
    stalled: false,
  })

  // Refs, not state: changing these must not restart the polling effect, or
  // every tick would tear down and rebuild the timer.
  const tickRef = useRef(0)
  const advanceRef = useRef(onAdvance)
  useEffect(() => {
    advanceRef.current = onAdvance
  }, [onAdvance])

  useEffect(() => {
    if (!enabled) return undefined

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const run = async (): Promise<void> => {
      if (cancelled) return

      // A backgrounded tab is throttled to the point of uselessness, and a
      // locked phone stops entirely. Skip the call and wait for the
      // visibilitychange below to resume, rather than queueing up work that
      // fires in a burst when the screen comes back.
      if (document.visibilityState !== 'visible') {
        schedule(POLL_MS)
        return
      }

      const tick = tickRef.current
      tickRef.current += 1

      try {
        const response = await fetch(`/api/rooms/${roomId}/playback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reconcile: tick % RECONCILE_EVERY === 0 }),
          cache: 'no-store',
        })

        if (cancelled) return

        if (!response.ok) {
          // 409 means manual mode or no token -- a settled answer, not a
          // blip, so stop asking rather than backing off forever.
          if (response.status === 409 || response.status === 403) {
            setPoll((current) => ({ ...current, stalled: false }))
            return
          }
          setPoll((current) => ({ ...current, stalled: true }))
          schedule(BACKOFF_MS)
          return
        }

        const data = (await response.json()) as PlaybackResponse
        if (cancelled) return

        setPoll({
          nowPlayingEntryId: data.nowPlayingEntryId,
          isPlaying: data.isPlaying,
          stalled: false,
        })

        // The server already broadcast to the room; this refreshes the host's
        // own view, which does not receive its own broadcast reliably.
        if (data.playedEntryIds.length > 0) advanceRef.current?.()

        schedule(POLL_MS)
      } catch {
        if (cancelled) return
        // No signal. Normal in a car; say so and slow down.
        setPoll((current) => ({ ...current, stalled: true }))
        schedule(BACKOFF_MS)
      }
    }

    function schedule(delay: number): void {
      if (cancelled) return
      timer = setTimeout(() => {
        void run()
      }, delay)
    }

    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return
      // Back from a locked screen: poll now instead of waiting out the timer,
      // since the runway on screen is however stale the screen was dark.
      if (timer !== undefined) clearTimeout(timer)
      void run()
    }

    document.addEventListener('visibilitychange', onVisible)
    void run()

    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [roomId, enabled])

  return poll
}
