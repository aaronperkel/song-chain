import { z } from 'zod'
import type { Track } from '@/lib/rules'

/**
 * Spotify responses, parsed rather than asserted.
 *
 * Only the fields the app uses are described, and every one of them is
 * checked, so a shape change surfaces here instead of as `undefined` three
 * layers into the game.
 */
export const SpotifyImageSchema = z.object({
  url: z.string(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
})

export const SpotifyArtistSchema = z.object({
  id: z.string(),
  name: z.string(),
})

export const SpotifyAlbumSchema = z.object({
  id: z.string(),
  name: z.string(),
  images: z.array(SpotifyImageSchema).default([]),
})

export const SpotifyTrackSchema = z.object({
  id: z.string(),
  uri: z.string(),
  name: z.string(),
  duration_ms: z.number(),
  explicit: z.boolean().optional(),
  artists: z.array(SpotifyArtistSchema),
  album: SpotifyAlbumSchema.optional(),
  is_playable: z.boolean().optional(),
})

export const SpotifySearchResponseSchema = z.object({
  tracks: z.object({
    items: z.array(SpotifyTrackSchema.nullable()),
    total: z.number(),
  }),
})

export const SpotifyTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
})

export type SpotifyTrack = z.infer<typeof SpotifyTrackSchema>
export type SpotifyTokenResponse = z.infer<typeof SpotifyTokenResponseSchema>

/**
 * A track as the app uses it: the rules-engine `Track` plus the presentation
 * fields the search UI needs. The rules engine only ever sees the subset it
 * declares, which is why it can stay free of Spotify types.
 */
export type AppTrack = Track & {
  uri: string
  albumName: string | null
  albumArtUrl: string | null
  explicit: boolean
}

function smallestImage(images: ReadonlyArray<{ url: string; width?: number | null }>): string | null {
  if (images.length === 0) return null
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
  return sorted[0]?.url ?? null
}

export function toAppTrack(track: SpotifyTrack): AppTrack {
  return {
    id: track.id,
    title: track.name,
    artists: track.artists.map((artist) => artist.name),
    durationMs: track.duration_ms,
    uri: track.uri,
    albumName: track.album?.name ?? null,
    albumArtUrl: smallestImage(track.album?.images ?? []),
    explicit: track.explicit ?? false,
  }
}
