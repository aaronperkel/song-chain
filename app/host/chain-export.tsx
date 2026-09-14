'use client'

import { useState } from 'react'
import type { PlaylistResponse } from '@/app/api/rooms/[id]/playlist/route'
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
  roomId,
  hostConnected,
}: {
  chain: readonly StoredEntry[]
  code: string
  roomId: string
  /** No Spotify account connected means no playlist to write to. */
  hostConnected: boolean
}): React.JSX.Element | null {
  const [text, setText] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [playlist, setPlaylist] = useState<PlaylistResponse | null>(null)
  const [needsGrant, setNeedsGrant] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (chain.length === 0) return null

  const savePlaylist = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    setNeedsGrant(null)

    try {
      const response = await fetch(`/api/rooms/${roomId}/playlist`, { method: 'POST' })
      const body: unknown = await response.json().catch(() => null)

      if (response.status === 403 && isGrantNeeded(body)) {
        // Not a failure: permission is granted separately and on purpose, so
        // this is the expected first answer. Offer the link instead.
        setNeedsGrant(body.authorizeUrl)
        return
      }

      if (!response.ok) {
        setError(
          typeof body === 'object' && body !== null && 'message' in body
            ? String((body as { message: unknown }).message)
            : 'Could not save the playlist.',
        )
        return
      }

      setPlaylist(body as PlaylistResponse)
    } catch {
      setError('No signal. The playlist was not created.')
    } finally {
      setSaving(false)
    }
  }

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
        {hostConnected && playlist === null ? (
          <button
            type="button"
            onClick={() => {
              void savePlaylist()
            }}
            disabled={saving}
            className="border-dusk-line text-paint min-h-[44px] rounded-lg border px-4 py-2 text-base disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save as a Spotify playlist'}
          </button>
        ) : null}
        {notice !== null ? <span className="text-paint-dim text-sm">{notice}</span> : null}
      </div>

      {needsGrant !== null ? (
        <div className="border-dusk-line mt-3 rounded-lg border px-3 py-3">
          <p className="text-paint-dim text-sm leading-snug">
            Spotify needs your permission to make a playlist. We did not ask for it when you
            connected, because until now there was nothing to write.
          </p>
          <a
            href={needsGrant}
            className="bg-sodium text-dusk font-display mt-3 inline-flex min-h-[44px] items-center rounded-lg px-4 py-2 text-lg uppercase"
          >
            Give permission
          </a>
        </div>
      ) : null}

      {playlist !== null ? (
        <p className="text-paint mt-3 text-base leading-snug" role="status">
          Saved {playlist.trackCount === 1 ? '1 song' : `${String(playlist.trackCount)} songs`} to
          a private playlist.{' '}
          {playlist.url !== null ? (
            <a href={playlist.url} target="_blank" rel="noreferrer" className="underline">
              Open it in Spotify
            </a>
          ) : null}
        </p>
      ) : null}

      {error !== null ? (
        <p className="text-brake mt-3 text-base" role="alert">
          {error}
        </p>
      ) : null}

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

/** The server's "you have not granted this yet" answer, which carries a link. */
function isGrantNeeded(body: unknown): body is { authorizeUrl: string } {
  return (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    (body as { error: unknown }).error === 'needs-playlist-scope' &&
    'authorizeUrl' in body &&
    typeof (body as { authorizeUrl: unknown }).authorizeUrl === 'string'
  )
}
