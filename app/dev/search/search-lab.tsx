'use client'

import Image from 'next/image'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  explain,
  stripJunkRanges,
  tokenizeTitle,
  validate,
  type Track,
} from '@/lib/rules'
import type { AppTrack } from '@/lib/spotify'

/**
 * Deliberately ugly. This page exists to audit the normalizer against titles
 * Spotify actually returns, so everything it knows is on screen: the tokens,
 * the junk rules that fired, and -- once a previous song is pinned -- the
 * verdict and the reason for every result.
 *
 * The rules engine is pure, so it runs unchanged in the browser here and on
 * the server at submit time. The server is still authoritative.
 */

const DEBOUNCE_MS = 300

/** A completed search, tagged with the query it answered. */
type SearchResult = {
  query: string
  tracks: AppTrack[]
  error: string | null
}

export function SearchLab(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<SearchResult>({ query: '', tracks: [], error: null })
  const [prev, setPrev] = useState<AppTrack | null>(null)
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
                : `HTTP ${String(response.status)}`
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
            error: cause instanceof Error ? cause.message : 'search failed',
          })
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      // Cancel the in-flight request for the query we are leaving behind.
      abortRef.current?.abort()
    }
  }, [trimmed])

  // Derived, not stored: results only show for the query on screen, so a
  // stale response can never flash up against a newer query.
  const fresh = result.query === trimmed
  const tracks = fresh ? result.tracks : []
  const error = fresh ? result.error : null
  const loading = trimmed.length > 0 && !fresh

  const clearPrev = useCallback(() => {
    setPrev(null)
  }, [])

  return (
    <div style={{ fontFamily: 'ui-monospace, monospace', padding: 16, maxWidth: 900 }}>
      <h1 style={{ fontSize: 18, fontWeight: 700 }}>search lab</h1>
      <p style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
        Normalizer audit surface. Pin a song as &quot;previous&quot; to run the real rules engine
        against every result.
      </p>

      {prev !== null ? <PinnedPrev track={prev} onClear={clearPrev} /> : null}

      <input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
        }}
        placeholder="search spotify..."
        style={{
          width: '100%',
          padding: '12px 14px',
          fontSize: 16,
          fontFamily: 'inherit',
          border: '2px solid #000',
        }}
      />

      <div style={{ fontSize: 12, margin: '8px 0', minHeight: 16 }}>
        {loading ? 'searching...' : null}
        {error !== null ? <span style={{ color: '#b00' }}>{error}</span> : null}
        {!loading && error === null && tracks.length > 0 ? `${String(tracks.length)} results` : null}
      </div>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {tracks.map((track) => (
          <ResultRow
            key={track.id}
            track={track}
            prev={prev}
            onPin={() => {
              setPrev(track)
            }}
          />
        ))}
      </ul>
    </div>
  )
}

function PinnedPrev({ track, onClear }: { track: AppTrack; onClear: () => void }): React.JSX.Element {
  return (
    <div style={{ border: '2px solid #05f', padding: 8, marginBottom: 12, fontSize: 12 }}>
      <strong>previous song:</strong> {track.title} — {track.artists.join(', ')}
      <br />
      <span style={{ color: '#666' }}>tokens: {tokenizeTitle(track.title).map((t) => t.norm).join(' · ')}</span>
      <br />
      <button type="button" onClick={onClear} style={{ marginTop: 6, padding: '6px 10px' }}>
        unpin
      </button>
    </div>
  )
}

function ResultRow({
  track,
  prev,
  onPin,
}: {
  track: AppTrack
  prev: AppTrack | null
  onPin: () => void
}): React.JSX.Element {
  const tokens = useMemo(() => tokenizeTitle(track.title), [track.title])
  const stripped = useMemo(() => stripJunkRanges(track.title), [track.title])

  const verdict = useMemo(() => {
    if (prev === null) return null
    const previous: Track = prev
    const candidate: Track = track
    const history = [
      { track: previous, matchedWord: null, matchedOn: null, via: null } as const,
    ]
    return {
      result: validate(previous, candidate, history, DEFAULT_SETTINGS),
      reasons: explain(previous, candidate, history, DEFAULT_SETTINGS),
    }
  }, [prev, track])

  const invalid = verdict !== null && !verdict.result.valid

  return (
    <li
      style={{
        display: 'flex',
        gap: 10,
        padding: 8,
        borderBottom: '1px solid #ddd',
        opacity: invalid ? 0.45 : 1,
      }}
    >
      {track.albumArtUrl !== null ? (
        <Image src={track.albumArtUrl} alt="" width={56} height={56} unoptimized />
      ) : (
        <div style={{ width: 56, height: 56, background: '#eee' }} />
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14 }}>
          {track.title}{' '}
          <span style={{ color: '#666' }}>
            — {track.artists.join(', ')} · {formatDuration(track.durationMs)}
          </span>
        </div>

        <div style={{ fontSize: 11, color: '#333', marginTop: 4 }}>
          tokens: {tokens.map((t) => t.norm).join(' · ') || <em>none</em>}
        </div>

        {stripped.length > 0 ? (
          <div style={{ fontSize: 11, color: '#a60' }}>
            stripped:{' '}
            {stripped
              .map((s) => `"${track.title.slice(s.range[0], s.range[1]).trim()}" (${s.rule})`)
              .join(', ')}
          </div>
        ) : null}

        {verdict !== null ? (
          <div style={{ fontSize: 11, marginTop: 4 }}>
            <strong>
              {verdict.result.valid
                ? `VALID — ${verdict.result.matchedWord} (${verdict.result.via})`
                : `INVALID — ${verdict.result.reason}`}
            </strong>
            {(verdict.reasons.blockers ?? []).map((blocker) => (
              <div key={blocker.kind} style={{ color: '#b00' }}>
                {blocker.why}
              </div>
            ))}
            {verdict.reasons.sharedWords.map((word) => (
              <div key={word.word} style={{ color: word.accepted ? '#070' : '#777' }}>
                {word.accepted ? '✓' : '✗'} {word.why}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <button type="button" onClick={onPin} style={{ padding: '6px 10px', alignSelf: 'start' }}>
        pin
      </button>
    </li>
  )
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`
}
