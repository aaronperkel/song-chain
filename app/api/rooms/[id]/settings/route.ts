import { NextResponse } from 'next/server'
import { badRequest } from '@/lib/api/respond'
import { isHostOf } from '@/lib/host/session'
import { broadcastRoomEvent } from '@/lib/realtime/broadcast'
import type { RuleSettings } from '@/lib/rules'
import { updateRoomSettings } from '@/lib/rooms/repo'
import { SettingsPatchSchema } from '@/lib/rooms/settings-schema'

/**
 * Change the house rules.
 *
 * Host-only. Everyone can see the rules; one person changes them, because a
 * car full of people editing the rules mid-game is how an argument starts.
 *
 * The change applies to subsequent picks only. Existing links keep the word
 * they were matched on, and nothing already in the chain is re-judged --
 * retroactively invalidating a pick someone already made is the one thing a
 * cooperative game must never do.
 */
export type SettingsResponse = { settings: RuleSettings }

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params

  if (!(await isHostOf(id))) {
    return NextResponse.json(
      { error: 'not-host', message: 'Only the host can change the rules.' },
      { status: 403 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid-request', message: 'Expected a JSON body.' },
      { status: 400 },
    )
  }

  const parsed = SettingsPatchSchema.safeParse(body)
  if (!parsed.success) return badRequest(parsed.error)

  const settings = await updateRoomSettings(id, parsed.data)
  if (settings === null) {
    return NextResponse.json({ error: 'no-room', message: 'Room not found.' }, { status: 404 })
  }

  // Every device shows the rules, so every device hears about the change.
  // Best-effort, like every broadcast: the write already succeeded, and a
  // phone that misses this picks the change up on its next state fetch.
  await broadcastRoomEvent(id, { type: 'settings', settings })

  const response: SettingsResponse = { settings }
  return NextResponse.json(response)
}
