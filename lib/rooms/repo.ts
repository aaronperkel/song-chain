import { withDefaults, type RuleSettings } from '@/lib/rules'
import { query, queryOne } from '@/lib/db'
import { generateCode, normalizeCode } from './codes'

export type RoomStatus = 'lobby' | 'playing' | 'paused' | 'ended'
export type RoomMode = 'live' | 'manual'

/** A room as the app uses it. Sealed token columns never leave this module. */
export type Room = {
  id: string
  code: string
  status: RoomStatus
  mode: RoomMode
  modeIsOverridden: boolean
  settings: RuleSettings
  hostSpotifyUserId: string | null
  hostDisplayName: string | null
  hostProduct: string | null
  hostScopes: string | null
  hasHostToken: boolean
  createdAt: string
}

type RoomRow = {
  id: string
  code: string
  status: RoomStatus
  mode: RoomMode
  mode_is_overridden: boolean
  settings: Partial<RuleSettings>
  host_spotify_user_id: string | null
  host_display_name: string | null
  host_product: string | null
  host_scopes: string | null
  host_refresh_token_enc: string | null
  created_at: Date
}

const ROOM_COLUMNS = `
  id, code, status, mode, mode_is_overridden, settings,
  host_spotify_user_id, host_display_name, host_product, host_scopes,
  host_refresh_token_enc, created_at
`

function toRoom(row: RoomRow): Room {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    mode: row.mode,
    modeIsOverridden: row.mode_is_overridden,
    // Stored as jsonb, so a setting added later is absent from old rows.
    settings: withDefaults(row.settings),
    hostSpotifyUserId: row.host_spotify_user_id,
    hostDisplayName: row.host_display_name,
    hostProduct: row.host_product,
    hostScopes: row.host_scopes,
    hasHostToken: row.host_refresh_token_enc !== null,
    createdAt: row.created_at.toISOString(),
  }
}

export class CodeCollisionError extends Error {
  constructor() {
    super('Could not find an unused join code')
    this.name = 'CodeCollisionError'
  }
}

/**
 * Create a room with a fresh join code.
 *
 * Retries on collision rather than checking first: the unique index is the
 * only thing that can actually settle a race between two hosts.
 */
export async function createRoom(hostSecretHash: string, attempts = 5): Promise<Room> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const code = generateCode()
    const rows = await query<RoomRow>(
      `insert into rooms (code, host_secret_hash)
       values ($1, $2)
       on conflict (code) do nothing
       returning ${ROOM_COLUMNS}`,
      [code, hostSecretHash],
    )
    const row = rows[0]
    if (row !== undefined) return toRoom(row)
  }
  throw new CodeCollisionError()
}

export async function findRoomById(id: string): Promise<Room | null> {
  const row = await queryOne<RoomRow>(`select ${ROOM_COLUMNS} from rooms where id = $1`, [id])
  return row === null ? null : toRoom(row)
}

export async function findRoomByCode(code: string): Promise<Room | null> {
  const row = await queryOne<RoomRow>(`select ${ROOM_COLUMNS} from rooms where code = $1`, [
    normalizeCode(code),
  ])
  return row === null ? null : toRoom(row)
}

/** The stored hash of the host's cookie secret, for authorising host actions. */
export async function findHostSecretHash(roomId: string): Promise<string | null> {
  const row = await queryOne<{ host_secret_hash: string }>(
    'select host_secret_hash from rooms where id = $1',
    [roomId],
  )
  return row?.host_secret_hash ?? null
}

export type HostSpotifyIdentity = {
  spotifyUserId: string
  displayName: string | null
  product: string | null
  scopes: string
  refreshTokenSealed: string
  accessTokenSealed: string
  accessTokenExpiresAt: Date
  mode: RoomMode
}

/** Record the host's Spotify connection after a successful auth callback. */
export async function saveHostIdentity(
  roomId: string,
  identity: HostSpotifyIdentity,
): Promise<Room | null> {
  const row = await queryOne<RoomRow>(
    `update rooms set
       host_spotify_user_id = $2,
       host_display_name = $3,
       host_product = $4,
       host_scopes = $5,
       host_refresh_token_enc = $6,
       host_access_token_enc = $7,
       host_access_token_expires_at = $8,
       -- A host override of the mode survives re-authentication.
       mode = case when mode_is_overridden then mode else $9 end
     where id = $1
     returning ${ROOM_COLUMNS}`,
    [
      roomId,
      identity.spotifyUserId,
      identity.displayName,
      identity.product,
      identity.scopes,
      identity.refreshTokenSealed,
      identity.accessTokenSealed,
      identity.accessTokenExpiresAt,
      identity.mode,
    ],
  )
  return row === null ? null : toRoom(row)
}

export type StoredHostTokens = {
  refreshTokenSealed: string | null
  accessTokenSealed: string | null
  accessTokenExpiresAt: Date | null
}

export async function findHostTokens(roomId: string): Promise<StoredHostTokens | null> {
  const row = await queryOne<{
    host_refresh_token_enc: string | null
    host_access_token_enc: string | null
    host_access_token_expires_at: Date | null
  }>(
    `select host_refresh_token_enc, host_access_token_enc, host_access_token_expires_at
     from rooms where id = $1`,
    [roomId],
  )
  if (row === null) return null
  return {
    refreshTokenSealed: row.host_refresh_token_enc,
    accessTokenSealed: row.host_access_token_enc,
    accessTokenExpiresAt: row.host_access_token_expires_at,
  }
}

/** Cache a freshly refreshed access token, and the rotated refresh token. */
export async function saveRefreshedTokens(
  roomId: string,
  tokens: {
    accessTokenSealed: string
    accessTokenExpiresAt: Date
    refreshTokenSealed?: string
  },
): Promise<void> {
  await query(
    `update rooms set
       host_access_token_enc = $2,
       host_access_token_expires_at = $3,
       host_refresh_token_enc = coalesce($4, host_refresh_token_enc)
     where id = $1`,
    [
      roomId,
      tokens.accessTokenSealed,
      tokens.accessTokenExpiresAt,
      tokens.refreshTokenSealed ?? null,
    ],
  )
}

export async function setRoomMode(
  roomId: string,
  mode: RoomMode,
  isOverride: boolean,
): Promise<void> {
  await query('update rooms set mode = $2, mode_is_overridden = $3 where id = $1', [
    roomId,
    mode,
    isOverride,
  ])
}

/**
 * Change the house rules mid-game.
 *
 * Merged into the stored JSON rather than replacing it, so a host toggling one
 * switch cannot blank the other six, and two hosts on two phones editing
 * different settings do not clobber each other.
 *
 * Applies to subsequent picks only. The chain keeps how each existing link was
 * actually matched -- re-judging settled songs under new rules would invalidate
 * picks people already made, which is the one thing a cooperative game must
 * never do.
 */
export async function updateRoomSettings(
  roomId: string,
  patch: Partial<RuleSettings>,
): Promise<RuleSettings | null> {
  const row = await queryOne<{ settings: Partial<RuleSettings> }>(
    `update rooms
     set settings = coalesce(settings, '{}'::jsonb) || $2::jsonb
     where id = $1
     returning settings`,
    [roomId, JSON.stringify(patch)],
  )
  return row === null ? null : withDefaults(row.settings)
}

export async function setRoomStatus(roomId: string, status: RoomStatus): Promise<void> {
  await query('update rooms set status = $2 where id = $1', [roomId, status])
}
