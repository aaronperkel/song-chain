'use client'

import { useState } from 'react'
import type { StoredEntry } from '@/lib/rooms/entry'
import { formatChain } from '@/lib/rooms/export'

/**
 * Taking the chain with you.
 *
 * Rooms are ephemeral, and a manual-mode room has no Spotify queue to look
 * back at afterwards, so this is the only thing that outlives the drive.
 *
 * Three routes out, in descending order of how good they feel on a phone, and
 * every one of them optional. `navigator.share` and `navigator.clipboard` are
 * both absent outside a secure context, which is exactly where guest phones
 * live -- a missing API here has already shipped once as a dead button, so the
 * last fallback is a textarea that cannot fail.
 */
export function ChainExport({
  chain,
  code,
}: {
  chain: readonly StoredEntry[]
  code: string
}): React.JSX.Element | null {
  const [text, setText] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  if (chain.length === 0) return null

  const build = (): string => formatChain(chain, code)

  const share = async (): Promise<void> => {
    const body = build()
    setNotice(null)

    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title: `Song Chain — ${code}`, text: body })
        return
      }

      // Optional chaining because `clipboard` is undefined, not merely
      // unavailable, on a page served over plain http.
      if (typeof navigator?.clipboard?.writeText === 'function') {
        await navigator.clipboard.writeText(body)
        setNotice('Copied.')
        return
      }

      setText(body)
    } catch {
      // A cancelled share rejects, and so does a blocked clipboard. Neither is
      // worth an error: show the text and let them take it by hand.
      setText(body)
    }
  }

  return (
    <div className="px-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            void share()
          }}
          className="border-dusk-line text-paint min-h-[44px] rounded-lg border px-4 py-2 text-base"
        >
          Save the chain
        </button>
        {notice !== null ? <span className="text-paint-dim text-sm">{notice}</span> : null}
      </div>

      {text !== null ? (
        <div className="mt-3">
          <p className="text-paint-dim mb-2 text-sm">
            Select this and copy it — this phone would not do it for us.
          </p>
          <textarea
            readOnly
            value={text}
            rows={Math.min(chain.length + 4, 16)}
            onFocus={(event) => {
              event.currentTarget.select()
            }}
            className="border-dusk-line bg-dusk text-paint w-full rounded-lg border p-3 font-mono text-xs"
          />
        </div>
      ) : null}
    </div>
  )
}
