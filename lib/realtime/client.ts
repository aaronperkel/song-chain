'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Browser Supabase client, used only to subscribe to room broadcasts.
 *
 * The publishable key is all a guest needs, and all they get: the policy on
 * realtime.messages grants SELECT and nothing else, and every table is
 * revoked from anon outright. No Spotify token or database access is ever
 * within reach of this client.
 */
let client: SupabaseClient | null = null

export function realtimeClient(): SupabaseClient | null {
  if (client !== null) return client

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (url === undefined || key === undefined) return null

  client = createClient(url, key, {
    auth: { persistSession: false },
    realtime: {
      // A car full of phones does not need a fast heartbeat, and a slower one
      // is kinder to batteries and to patchy signal.
      params: { eventsPerSecond: 5 },
    },
  })
  return client
}
