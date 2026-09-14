import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it } from 'vitest'
import { broadcastRoomEvent } from './broadcast'
import { ROOM_EVENT_NAME, roomTopic, type RoomEvent } from './events'

/**
 * Proves the whole realtime path against the live project: a server-side
 * REST broadcast reaching a browser-style subscriber that holds nothing but
 * the publishable key.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  ''

let client: SupabaseClient | null = null
let channel: RealtimeChannel | null = null

afterEach(async () => {
  if (channel !== null) await channel.unsubscribe()
  if (client !== null) client.realtime.disconnect()
  channel = null
  client = null
})

/** Subscribe the way a guest's phone does, then wait for one event. */
async function listenOnce(roomId: string, timeoutMs = 10_000): Promise<RoomEvent> {
  client = createClient(url, publishableKey)
  const subscriber = client

  return new Promise<RoomEvent>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('no broadcast arrived'))
    }, timeoutMs)

    channel = subscriber
      .channel(roomTopic(roomId))
      .on('broadcast', { event: ROOM_EVENT_NAME }, (message) => {
        clearTimeout(timer)
        resolve(message.payload as RoomEvent)
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timer)
          reject(new Error(`subscribe failed: ${status}`))
        }
      })
  })
}

describe('room broadcasts', () => {
  it('reaches a subscriber holding only the publishable key', async () => {
    const roomId = crypto.randomUUID()
    const received = listenOnce(roomId)

    // Give the subscription a moment to be established before sending.
    await new Promise((resolve) => setTimeout(resolve, 1500))

    const sent = await broadcastRoomEvent(roomId, {
      type: 'turn',
      turn: { currentSeatId: 'seat-123', turnStartedAt: '2026-09-14T12:00:00.000Z' },
    })
    expect(sent).toBe(true)

    await expect(received).resolves.toEqual({
      type: 'turn',
      turn: { currentSeatId: 'seat-123', turnStartedAt: '2026-09-14T12:00:00.000Z' },
    })
  })

  it('does not deliver one room’s events to another room', async () => {
    const listening = crypto.randomUUID()
    const other = crypto.randomUUID()
    const received = listenOnce(listening, 4000)

    await new Promise((resolve) => setTimeout(resolve, 1500))
    await broadcastRoomEvent(other, { type: 'turn', turn: { currentSeatId: 'x', turnStartedAt: null } })

    await expect(received).rejects.toThrow(/no broadcast arrived/)
  })

  it('reports failure instead of throwing when misconfigured', async () => {
    const original = process.env.SUPABASE_URL
    const originalPublic = process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    try {
      // A broadcast failure must never fail the pick that caused it.
      await expect(
        broadcastRoomEvent(crypto.randomUUID(), {
          type: 'turn',
          turn: { currentSeatId: null, turnStartedAt: null },
        }),
      ).resolves.toBe(false)
    } finally {
      if (original !== undefined) process.env.SUPABASE_URL = original
      if (originalPublic !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = originalPublic
    }
  })
})
