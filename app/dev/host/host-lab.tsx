'use client'

import { useCallback, useState } from 'react'
import type { AppTrack } from '@/lib/spotify'

/**
 * Step 3 driver: create a room, connect Spotify, queue one track.
 *
 * Deliberately ugly, like /dev/search. The real host screen is step 4's job;
 * this exists to prove the auth and queue path end to end.
 */
type Room = { id: string; code: string; mode: string; status: string }

export function HostLab({
  authOutcome,
  authDetail,
}: {
  authOutcome: string | null
  authDetail: string | null
}): React.JSX.Element {
  const [room, setRoom] = useState<Room | null>(null)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AppTrack[]>([])

  const say = useCallback((line: string) => {
    setLog((previous) => [`${new Date().toLocaleTimeString()}  ${line}`, ...previous])
  }, [])

  const createRoom = useCallback(async () => {
    setBusy(true)
    try {
      const response = await fetch('/api/rooms', { method: 'POST' })
      const body: unknown = await response.json()
      if (!response.ok) {
        say(`room create failed: ${JSON.stringify(body)}`)
        return
      }
      const created = body as Room
      setRoom(created)
      say(`room ${created.code} created (${created.id})`)
    } finally {
      setBusy(false)
    }
  }, [say])

  const search = useCallback(async () => {
    const trimmed = query.trim()
    if (trimmed.length === 0) return
    const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=10`)
    const body: unknown = await response.json()
    if (!response.ok) {
      say(`search failed: ${JSON.stringify(body)}`)
      return
    }
    setResults((body as { tracks: AppTrack[] }).tracks)
  }, [query, say])

  const queue = useCallback(
    async (track: AppTrack) => {
      if (room === null) return
      setBusy(true)
      try {
        const response = await fetch(`/api/rooms/${room.id}/queue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uri: track.uri }),
        })
        const body: unknown = await response.json()
        say(
          response.ok
            ? `QUEUED "${track.title}" -> ${track.uri}`
            : `queue failed (${String(response.status)}): ${JSON.stringify(body)}`,
        )
      } finally {
        setBusy(false)
      }
    },
    [room, say],
  )

  return (
    <div style={{ fontFamily: 'ui-monospace, monospace', padding: 16, maxWidth: 860 }}>
      <h1 style={{ fontSize: 18, fontWeight: 700 }}>host lab</h1>
      <p style={{ fontSize: 12, color: '#666' }}>
        Step 3 check: PKCE host auth and one real queue write.
      </p>

      {authOutcome !== null ? (
        <div
          style={{
            border: `2px solid ${authOutcome === 'ok' ? '#070' : '#b00'}`,
            padding: 8,
            margin: '8px 0',
            fontSize: 12,
          }}
        >
          spotify auth: <strong>{authOutcome}</strong>
          {authDetail !== null ? ` (${authDetail})` : null}
        </div>
      ) : null}

      <ol style={{ fontSize: 13, paddingLeft: 20, lineHeight: 1.9 }}>
        <li>
          <button type="button" onClick={() => void createRoom()} disabled={busy}>
            create room
          </button>
          {room !== null ? (
            <span>
              {' '}
              code <strong>{room.code}</strong>, mode <strong>{room.mode}</strong>
            </span>
          ) : null}
        </li>
        <li>
          <a href="/api/auth/spotify/login">
            <button type="button" disabled={room === null}>
              connect spotify
            </button>
          </a>{' '}
          <span style={{ color: '#666' }}>(needs a room first)</span>
        </li>
        <li>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void search()
            }}
            placeholder="search a track..."
            style={{ padding: 8, fontFamily: 'inherit', fontSize: 14 }}
          />{' '}
          <button type="button" onClick={() => void search()}>
            search
          </button>
        </li>
      </ol>

      <ul style={{ listStyle: 'none', padding: 0 }}>
        {results.map((track) => (
          <li
            key={track.id}
            style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 4, fontSize: 13 }}
          >
            <button type="button" onClick={() => void queue(track)} disabled={busy || room === null}>
              queue
            </button>
            <span>
              {track.title} — {track.artists.join(', ')}
            </span>
          </li>
        ))}
      </ul>

      <pre
        style={{
          background: '#111',
          color: '#0f0',
          padding: 10,
          fontSize: 11,
          minHeight: 80,
          overflowX: 'auto',
        }}
      >
        {log.join('\n') || 'no events yet'}
      </pre>
    </div>
  )
}
