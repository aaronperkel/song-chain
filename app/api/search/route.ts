import { NextResponse } from 'next/server'
import { z } from 'zod'
import { badRequest, spotifyErrorResponse } from '@/lib/api/respond'
import { SEARCH_LIMIT_MAX, searchTracks, type AppTrack } from '@/lib/spotify'

/**
 * Server-proxied track search.
 *
 * Guests hit this instead of Spotify: it runs on an app token, so nobody
 * needs a Spotify account, no client secret reaches a browser, and search
 * survives the host's token refreshing.
 */
const QuerySchema = z.object({
  q: z.string().trim().min(1, 'a search query is required').max(200),
  limit: z.coerce.number().int().min(1).max(SEARCH_LIMIT_MAX).optional(),
  market: z
    .string()
    .regex(/^[A-Za-z]{2}$/, 'market must be a two-letter country code')
    .optional(),
})

export type SearchResponse = { tracks: AppTrack[] }

export async function GET(request: Request): Promise<NextResponse<SearchResponse | { error: string; message: string }>> {
  const params = new URL(request.url).searchParams
  const parsed = QuerySchema.safeParse({
    q: params.get('q') ?? '',
    limit: params.get('limit') ?? undefined,
    market: params.get('market') ?? undefined,
  })

  if (!parsed.success) return badRequest(parsed.error)

  try {
    const tracks = await searchTracks(parsed.data.q, {
      limit: parsed.data.limit,
      market: parsed.data.market?.toUpperCase(),
    })
    return NextResponse.json({ tracks })
  } catch (error) {
    return spotifyErrorResponse(error)
  }
}
