import { NextResponse } from 'next/server'
import { spotifyErrorResponse } from '@/lib/api/respond'
import { isHostOf } from '@/lib/host/session'
import { listChain } from '@/lib/rooms/chain'
import { findRoomById } from '@/lib/rooms/repo'
import { addTracksToPlaylist, createPlaylist, hasPlaylistScope } from '@/lib/spotify'

/**
 * Write the chain out as a Spotify playlist.
 *
 * Manual mode's payoff: a non-Premium host can never queue anything, so this
 * is the version of the drive they can actually play again. Host-only, because
 * it writes to the host's own library.
 *
 * Takes no body. The chain is the input, and the server already holds it --
 * accepting a track list from the browser would let a caller write arbitrary
 * songs into someone's Spotify account.
 */
export type PlaylistResponse = {
  playlistId: string
  url: string | null
  trackCount: number
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params

  if (!(await isHostOf(id))) {
    return NextResponse.json(
      { error: 'not-host', message: 'Only the host can save a playlist.' },
      { status: 403 },
    )
  }

  const room = await findRoomById(id)
  if (room === null) {
    return NextResponse.json({ error: 'no-room', message: 'Room not found.' }, { status: 404 })
  }
  if (!room.hasHostToken || room.hostSpotifyUserId === null) {
    return NextResponse.json(
      { error: 'no-host-token', message: 'Connect Spotify first.' },
      { status: 409 },
    )
  }

  // The scope is granted separately and later, so this is the ordinary case
  // on a first attempt rather than an error. The client turns it into a
  // "grant access" link instead of a failure.
  if (!hasPlaylistScope(room.hostScopes)) {
    return NextResponse.json(
      {
        error: 'needs-playlist-scope',
        message: 'Spotify needs permission to create playlists.',
        authorizeUrl: '/api/auth/spotify/login?scopes=playlist',
      },
      { status: 403 },
    )
  }

  const chain = await listChain(id)
  if (chain.length === 0) {
    return NextResponse.json(
      { error: 'empty-chain', message: 'There are no songs to save yet.' },
      { status: 409 },
    )
  }

  const today = new Date().toISOString().slice(0, 10)

  try {
    const playlist = await createPlaylist(id, {
      userId: room.hostSpotifyUserId,
      name: `Song Chain — ${room.code}`,
      description: `${String(chain.length)} songs, each sharing a word with the last. ${today}`,
    })

    const trackCount = await addTracksToPlaylist(
      id,
      playlist.id,
      chain.map((entry) => entry.track.uri),
    )

    const response: PlaylistResponse = {
      playlistId: playlist.id,
      url: playlist.url,
      trackCount,
    }
    return NextResponse.json(response, { status: 201 })
  } catch (error) {
    return spotifyErrorResponse(error)
  }
}
