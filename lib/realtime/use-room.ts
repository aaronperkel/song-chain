'use client'

import { useCallback, useEffect, useState } from 'react'
import type { RoomState } from '@/lib/api/room-state'
import { realtimeClient } from './client'
import { ROOM_EVENT_NAME, roomTopic, type RoomEvent } from './events'

/**
 * Connection state, shown to the player rather than hidden.
 *
 * This is a car app. Losing signal is normal, and an interface that silently
 * stops updating is worse than one that says so.
 */
export type Connection = 'connecting' | 'live' | 'offline'

/** How often to re-fetch while disconnected, as a safety net. */
const OFFLINE_RETRY_MS = 8_000

/** Without these, nothing will ever connect, so start honest rather than hopeful. */
function realtimeConfigured(): boolean {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL !== undefined &&
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) !== undefined
  )
}

export function useRoom(initial: RoomState): {
  state: RoomState
  connection: Connection
  refresh: () => Promise<void>
} {
  const [state, setState] = useState(initial)
  const [connection, setConnection] = useState<Connection>(
    realtimeConfigured() ? 'connecting' : 'offline',
  )
  const roomId = initial.room.id

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(`/api/rooms/${roomId}/state`, { cache: 'no-store' })
      if (!response.ok) return
      setState((await response.json()) as RoomState)
    } catch {
      // Offline. The connection indicator already says so.
    }
  }, [roomId])

  useEffect(() => {
    const client = realtimeClient()
    // Already reported as offline by the initial state; nothing to subscribe to.
    if (client === null) return undefined

    const channel = client
      .channel(roomTopic(roomId))
      .on('broadcast', { event: ROOM_EVENT_NAME }, (message) => {
        setState((current) => apply(current, message.payload as RoomEvent))
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnection('live')
          // Catch up on anything that happened while disconnected. The
          // payloads we missed are gone, so take the whole room again.
          void refresh()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConnection('offline')
        }
      })

    return () => {
      void channel.unsubscribe()
    }
  }, [roomId, refresh])

  // Coming back from a locked screen or a backgrounded tab: the host's
  // playback polling stopped and events were missed either way.
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const onOnline = (): void => {
      void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [refresh])

  // While disconnected, fall back to asking. Realtime is the fast path, not
  // the only one.
  useEffect(() => {
    if (connection === 'live') return undefined
    const timer = setInterval(() => {
      void refresh()
    }, OFFLINE_RETRY_MS)
    return () => {
      clearInterval(timer)
    }
  }, [connection, refresh])

  return { state, connection, refresh }
}

/**
 * Fold a broadcast into local state.
 *
 * Every case is written to be safe to apply twice: a phone that reconnects
 * may receive an event it already has, and the submitting device applies its
 * own pick from the response before the broadcast arrives.
 */
export function apply(state: RoomState, event: RoomEvent): RoomState {
  switch (event.type) {
    case 'pick':
    case 'seed': {
      const alreadyHave = state.chain.some((entry) => entry.id === event.entry.id)
      const chain = alreadyHave
        ? state.chain
        : [...state.chain, event.entry].sort((a, b) => a.position - b.position)
      return {
        ...state,
        chain,
        turn: event.turn,
        runway: event.runway,
        you: { ...state.you, isYourTurn: isYourTurn(state, event.turn.currentSeatId) },
      }
    }
    case 'undo':
      return {
        ...state,
        chain: state.chain.filter((entry) => entry.id !== event.removedEntryId),
        turn: event.turn,
        runway: event.runway,
        you: { ...state.you, isYourTurn: isYourTurn(state, event.turn.currentSeatId) },
      }
    case 'seats':
      return {
        ...state,
        seats: event.seats,
        turn: event.turn,
        you: { ...state.you, isYourTurn: isYourTurn(state, event.turn.currentSeatId) },
      }
    case 'turn':
      return {
        ...state,
        turn: event.turn,
        you: { ...state.you, isYourTurn: isYourTurn(state, event.turn.currentSeatId) },
      }
    case 'playback': {
      const played = new Set(event.playedEntryIds)
      return {
        ...state,
        chain: state.chain.map((entry) =>
          played.has(entry.id) && entry.playedAt === null
            ? { ...entry, playedAt: new Date().toISOString() }
            : entry,
        ),
        runway: event.runway,
      }
    }
    case 'room':
      return { ...state, room: { ...state.room, status: event.status, mode: event.mode } }
    case 'settings':
      // The chain is untouched: every existing link keeps the word it was
      // actually matched on. New rules judge new picks only.
      return { ...state, room: { ...state.room, settings: event.settings } }
  }
}

function isYourTurn(state: RoomState, currentSeatId: string | null): boolean {
  return state.you.seatId !== null && state.you.seatId === currentSeatId
}
