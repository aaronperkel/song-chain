import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closePool } from '@/lib/db'
import { DEFAULT_SETTINGS } from '@/lib/rules'
import { dropRoom, makeRoom } from '@/test/room-fixture'
import { findRoomById, updateRoomSettings } from './repo'

/**
 * The settings column is one JSON blob, so the danger is not a rejected write
 * but a successful one that quietly drops the other rules. A host toggling
 * "little words" must not reset the turn timer they set ten minutes ago.
 */
let roomId = ''

beforeEach(async () => {
  const { room } = await makeRoom()
  roomId = room.id
})

afterEach(async () => {
  await dropRoom(roomId)
  await closePool()
})

describe('updateRoomSettings', () => {
  it('starts from the defaults', async () => {
    const room = await findRoomById(roomId)

    expect(room?.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('changes one rule and returns the whole resolved set', async () => {
    const settings = await updateRoomSettings(roomId, { stopwords: 'allow' })

    expect(settings).toEqual({ ...DEFAULT_SETTINGS, stopwords: 'allow' })
  })

  it('merges rather than replaces, so one change cannot blank the rest', async () => {
    await updateRoomSettings(roomId, { turnTimer: 60 })
    await updateRoomSettings(roomId, { wordReuse: 'burnOnce' })
    const settings = await updateRoomSettings(roomId, { stopwords: 'allow' })

    expect(settings).toEqual({
      ...DEFAULT_SETTINGS,
      turnTimer: 60,
      wordReuse: 'burnOnce',
      stopwords: 'allow',
    })
  })

  it('persists, so a phone re-reading the room sees the change', async () => {
    await updateRoomSettings(roomId, { matchScope: 'titleAndArtist', artistCooldown: 3 })

    const room = await findRoomById(roomId)

    expect(room?.settings.matchScope).toBe('titleAndArtist')
    expect(room?.settings.artistCooldown).toBe(3)
  })

  it('can set a value back to its default', async () => {
    await updateRoomSettings(roomId, { turnTimer: 120 })
    const settings = await updateRoomSettings(roomId, { turnTimer: 0 })

    expect(settings?.turnTimer).toBe(0)
  })

  it('keeps allowRepeatSongs false whatever is stored', async () => {
    // TypeScript refuses this without the cast, which is the first line of
    // defence. The cast simulates a hand-edited row reaching withDefaults,
    // which pins the value regardless of what the column says.
    const settings = await updateRoomSettings(
      roomId,
      { allowRepeatSongs: true } as unknown as Parameters<typeof updateRoomSettings>[1],
    )

    expect(settings?.allowRepeatSongs).toBe(false)
  })

  it('returns null for a room that does not exist', async () => {
    const settings = await updateRoomSettings(
      '00000000-0000-0000-0000-000000000000',
      { stopwords: 'allow' },
    )

    expect(settings).toBeNull()
  })
})
