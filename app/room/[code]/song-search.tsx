'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { explain, validate, type ChainEntry, type RuleSettings, type Track } from '@/lib/rules'
import type { AppTrack } from '@/lib/spotify'
import type { StoredEntry } from '@/lib/rooms/entry'

const DEBOUNCE_MS = 300

/**
 * Search and pick, on a phone, in a moving car.
 *
 * Results are judged locally by the same rules engine the server runs, so a
 * player sees *before* tapping whether a song links and why not. The server
 * re-validates regardless -- this is a courtesy, never the decision.
 */
export function SongSearch({
  previous,
  history,
  settings,
  onPick,
  disabled,
}: {
  previous: StoredEntry | null
  history: readonly ChainEntry[]
  settings: RuleSettings
  onPick: (track: AppTrack) => void
  disabled: boolean
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<{ query: string; tracks: AppTrack[]; error: string | null }>({
    query: '',
    tracks: [],
    error: null,
  })
  const abortRef = useRef<AbortController | null>(null)
  const trimmed = query.trim()

  useEffect(() => {
    if (trimmed.length === 0) return undefined

    const timer = setTimeout(() => {
      const controller = new AbortController()
      abortRef.current = controller

      fetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=10`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          const body: unknown = await response.json()
          if (!response.ok) {
            const message =
              typeof body === 'object' && body !== null && 'message' in body
                ? String((body as { message: unknown }).message)
                : 'Search failed.'
            throw new Error(message)
          }
          return body as { tracks: AppTrack[] }
        })
        .then((body) => {
          setResult({ query: trimmed, tracks: body.tracks, error: null })
        })
        .catch((cause: unknown) => {
          if (cause instanceof Error && cause.name === 'AbortError') return
          setResult({
            query: trimmed,
            tracks: [],
            error: cause instanceof Error ? cause.message : 'Search failed.',
          })
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      abortRef.current?.abort()
    }
  }, [trimmed])

  // Derived, so a slow response can never appear under a newer query.
  const fresh = result.query === trimmed
  const tracks = fresh ? result.tracks : []
  const searchError = fresh ? result.error : null
  const searching = trimmed.length > 0 && !fresh

  return (
    <div>
      <input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
        }}
        disabled={disabled}
        enterKeyHint="search"
        autoCapitalize="none"
        autoCorrect="off"
        placeholder="Search for a song"
        aria-label="Search for a song"
        className="text-paint placeholder:text-paint-dim border-dusk-line bg-dusk-raised w-full rounded-lg border px-4 py-3 text-xl"
      />

      {searchError !== null ? (
        <p className="text-brake mt-3 text-base" role="alert">
          {searchError}
        </p>
      ) : null}
      {searching ? <p className="text-paint-dim mt-3 text-sm">Searching</p> : null}

      <ul className="mt-2">
        {tracks.map((track) => (
          <Result
            key={track.id}
            track={track}
            previous={previous}
            history={history}
            settings={settings}
            onPick={onPick}
            disabled={disabled}
          />
        ))}
      </ul>
    </div>
  )
}

function Result({
  track,
  previous,
  history,
  settings,
  onPick,
  disabled,
}: {
  track: AppTrack
  previous: StoredEntry | null
  history: readonly ChainEntry[]
  settings: RuleSettings
  onPick: (track: AppTrack) => void
  disabled: boolean
}): React.JSX.Element {
  const verdict = useMemo(() => {
    if (previous === null) return null
    const previousTrack: Track = {
      id: previous.track.id,
      title: previous.track.title,
      artists: previous.track.artists,
      durationMs: previous.track.durationMs,
    }
    const candidate: Track = {
      id: track.id,
      title: track.title,
      artists: track.artists,
      durationMs: track.durationMs,
    }
    return {
      result: validate(previousTrack, candidate, history, settings),
      reasons: explain(previousTrack, candidate, history, settings),
    }
  }, [previous, track, history, settings])

  const rejected = verdict !== null && !verdict.result.valid
  const matchedWord =
    verdict !== null && verdict.result.valid ? verdict.result.matchedWord : null

  return (
    <li className="border-dusk-line border-b last:border-0">
      <button
        type="button"
        disabled={disabled || rejected}
        onClick={() => {
          onPick(track)
        }}
        className="flex w-full items-start gap-3 py-3 text-left disabled:opacity-50"
      >
        <span className="min-w-0 flex-1">
          <span className="text-paint block text-lg leading-tight">
            {matchedWord === null ? track.title : highlight(track.title, matchedWord)}
          </span>
          <span className="text-paint-dim block truncate text-sm">
            {track.artists.join(', ')} — {formatDuration(track.durationMs)}
          </span>
          {rejected ? (
            <span className="text-brake mt-0.5 block text-sm leading-snug">
              {whyNot(verdict.reasons, verdict.result.valid ? null : verdict.result.reason)}
            </span>
          ) : null}
        </span>
        {!rejected ? (
          <span className="font-display text-sodium shrink-0 text-lg leading-none">add</span>
        ) : null}
      </button>
    </li>
  )
}

/** Show the linking word in the title, so the reason is visible not stated. */
function highlight(title: string, word: string): React.JSX.Element {
  const index = title.toLowerCase().indexOf(word.toLowerCase())
  if (index < 0) return <>{title}</>
  return (
    <>
      {title.slice(0, index)}
      <mark className="bg-transparent text-sodium">{title.slice(index, index + word.length)}</mark>
      {title.slice(index + word.length)}
    </>
  )
}

/**
 * The rejection, in a sentence. Blockers first: "you already played this" is
 * more use than a list of words that happened to match.
 */
function whyNot(
  reasons: { sharedWords: Array<{ why: string; accepted: boolean }>; blockers?: Array<{ why: string }> },
  reason: string | null,
): string {
  const blocker = reasons.blockers?.[0]
  if (blocker !== undefined) return blocker.why

  const blocked = reasons.sharedWords.find((word) => !word.accepted)
  if (blocked !== undefined) return blocked.why

  if (reason === 'no-shared-word') return 'Shares no word with the last song'
  return 'Not a link'
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  return `${String(Math.floor(totalSeconds / 60))}:${String(totalSeconds % 60).padStart(2, '0')}`
}
