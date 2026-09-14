import { ROOM_EVENT_NAME, roomTopic, type RoomEvent } from './events'

/**
 * Broadcast a room event from the server.
 *
 * Over Realtime's REST endpoint rather than a WebSocket: a route handler that
 * opens a socket, sends one message and tears it down would pay connection
 * setup on every pick, and serverless instances come and go. This is a single
 * HTTP POST.
 *
 * Broadcasting is best-effort by design. Clients hold the authoritative state
 * from the submit response or a state fetch, so a dropped broadcast costs a
 * slower update -- never a wrong chain. A failure here must therefore never
 * fail the pick that caused it.
 */
export async function broadcastRoomEvent(roomId: string, event: RoomEvent): Promise<boolean> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  // The secret key bypasses RLS, which is why only the server can send.
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY

  if (url === undefined || key === undefined) {
    console.error('[realtime] not configured; event dropped', event.type)
    return false
  }

  const endpoint = `${url}/realtime/v1/api/broadcast`

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ topic: roomTopic(roomId), event: ROOM_EVENT_NAME, payload: event }],
      }),
      cache: 'no-store',
    })

    if (!response.ok) {
      console.error('[realtime] broadcast rejected', response.status, event.type)
      return false
    }
    return true
  } catch (error) {
    console.error('[realtime] broadcast failed', error)
    return false
  }
}
