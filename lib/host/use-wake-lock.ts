'use client'

import { useEffect } from 'react'

/**
 * Keeping the host's screen awake.
 *
 * The host phone is propped on the dash for the length of a drive, and it is
 * the only phone with a job to do while nobody is touching it: it polls
 * Spotify so the runway moves. A phone that sleeps after thirty seconds stops
 * polling, and the queue total in the car goes stale until somebody picks the
 * phone back up.
 *
 * Nobody else needs this. A guest's phone sleeping between turns is correct
 * behaviour, and their battery has to last the trip too.
 *
 * Nothing is returned and nothing is shown. A lock that cannot be taken --
 * plain http, or a phone low enough on battery that the browser refuses --
 * costs the game nothing: the screen dims as it always did, and the poll it
 * interrupts already reports itself as stalled.
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    // `navigator.wakeLock` is typed as always present but is genuinely
    // undefined outside a secure context, so this asks the object rather
    // than trusting the type. Secure-context APIs are how this app has
    // shipped dead buttons before.
    if (!enabled || typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      return undefined
    }

    let cancelled = false
    let sentinel: WakeLockSentinel | null = null

    const acquire = async (): Promise<void> => {
      // A request from a hidden document is rejected outright. Wait for the
      // visibilitychange below instead of burning the attempt.
      if (cancelled || sentinel !== null || document.visibilityState !== 'visible') return

      try {
        const next = await navigator.wakeLock.request('screen')

        // Torn down while the request was in flight: let go of the lock we
        // just took, or it outlives the screen that asked for it.
        if (cancelled) {
          void next.release()
          return
        }

        sentinel = next

        // The browser drops the lock on its own when the page is hidden, and
        // says so here. Clearing the sentinel is what lets us take a fresh
        // one when the screen comes back.
        next.addEventListener('release', () => {
          sentinel = null
        })
      } catch {
        // Refused -- low battery, or the tab lost focus mid-request. Leave it;
        // the visibilitychange handler gets the next honest chance.
      }
    }

    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void acquire()
    }

    document.addEventListener('visibilitychange', onVisible)
    void acquire()

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      if (sentinel !== null) void sentinel.release()
    }
  }, [enabled])
}
