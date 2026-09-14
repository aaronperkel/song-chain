'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * The first thing a host does. One button, because everything else -- the
 * code, the QR, Spotify -- follows from having a room.
 */
export function StartGame(): React.JSX.Element {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/rooms', { method: 'POST' })
      if (!response.ok) {
        setError('Could not start a game. Try again.')
        return
      }
      // The host cookie is set by the response; the page reads the room from it.
      router.refresh()
    } catch {
      setError('No signal. A game needs a connection to start.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-between px-5 py-10">
      <div>
        <h1 className="font-display text-paint text-shout uppercase">Start a game</h1>
        <p className="text-paint-dim mt-4 max-w-[32ch] text-lg leading-snug">
          This phone keeps the music and the controls. Everyone else joins with a code — they need
          nothing installed.
        </p>
      </div>

      <div>
        {error !== null ? (
          <p className="text-brake mb-4 text-base" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => {
            void create()
          }}
          disabled={busy}
          className="bg-sodium text-dusk font-display w-full rounded-lg px-5 py-4 text-2xl uppercase disabled:opacity-40"
        >
          {busy ? 'Starting' : 'Open a room'}
        </button>
      </div>
    </main>
  )
}
