'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { CODE_LENGTH, isValidCode, normalizeCode } from '@/lib/rooms/codes'

/**
 * Join by code and name.
 *
 * Two fields, both large, both reachable with a thumb. The code input is the
 * width of a code and nothing more, so it reads as "five characters" without
 * needing to say so.
 */
export function JoinForm({ initialCode }: { initialCode: string }): React.JSX.Element {
  const router = useRouter()
  const [code, setCode] = useState(normalizeCode(initialCode))
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const ready = isValidCode(code) && name.trim().length > 0

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch('/api/rooms/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name }),
      })
      const body: unknown = await response.json()

      if (!response.ok) {
        const message =
          typeof body === 'object' && body !== null && 'message' in body
            ? String((body as { message: unknown }).message)
            : 'Could not join that room.'
        setError(message)
        return
      }

      router.push(`/room/${code}`)
    } catch {
      setError('No signal. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      className="flex flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready && !submitting) void submit()
      }}
    >
      <div className="flex-1">
        <label htmlFor="code" className="text-paint-dim block text-base">
          Join code
        </label>
        <input
          id="code"
          value={code}
          onChange={(event) => {
            setCode(normalizeCode(event.target.value).slice(0, CODE_LENGTH))
          }}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          enterKeyHint="next"
          placeholder="ABCDE"
          className="font-display text-paint placeholder:text-dusk-line border-dusk-line bg-dusk-raised mt-2 w-full rounded-lg border px-4 py-3 text-4xl tracking-[0.22em] uppercase"
        />

        <label htmlFor="name" className="text-paint-dim mt-7 block text-base">
          Your name
        </label>
        <input
          id="name"
          value={name}
          onChange={(event) => {
            setName(event.target.value)
          }}
          maxLength={24}
          enterKeyHint="go"
          placeholder="Sam"
          className="text-paint placeholder:text-dusk-line border-dusk-line bg-dusk-raised mt-2 w-full rounded-lg border px-4 py-3 text-2xl"
        />
        <p className="text-paint-dim mt-2 text-sm">
          This is what the others see when it is your turn.
        </p>

        {error !== null ? (
          <p className="text-brake mt-6 text-base leading-snug" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={!ready || submitting}
        className="bg-sodium text-dusk font-display mt-8 rounded-lg px-5 py-4 text-2xl uppercase disabled:opacity-40"
      >
        {submitting ? 'Joining' : 'Take a seat'}
      </button>
    </form>
  )
}
