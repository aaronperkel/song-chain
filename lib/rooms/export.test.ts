import { describe, expect, it } from 'vitest'
import type { StoredEntry } from './entry'
import { formatChain, trackDeepLink, trackWebLink } from './export'

/**
 * The export is what outlives the room. Rooms are ephemeral and a manual-mode
 * room has no Spotify queue to look back at, so if this drops the linking
 * words it throws away the only record of what the game actually was.
 */
function entry(over: Partial<StoredEntry> = {}): StoredEntry {
  return {
    id: 'e1',
    position: 0,
    track: {
      id: '3n3Ppam7vgaVa1iaRUc9Lp',
      uri: 'spotify:track:3n3Ppam7vgaVa1iaRUc9Lp',
      title: 'Yellow Submarine',
      artists: ['The Beatles'],
      durationMs: 160_000,
      albumName: 'Revolver',
      albumArtUrl: null,
      explicit: false,
    },
    matchedWord: 'Yellow',
    matchedOn: 'title',
    via: 'exact',
    seatId: 's1',
    seatName: 'Aaron',
    isSeed: false,
    wasOverride: false,
    queuedToSpotify: true,
    playedAt: null,
    createdAt: '2026-09-14T10:00:00.000Z',
    ...over,
  }
}

describe('formatChain', () => {
  it('heads the export with the room code', () => {
    expect(formatChain([entry()], 'KDJPG')).toContain('Song Chain — KDJPG')
  })

  it('says so plainly when there is nothing yet', () => {
    const text = formatChain([], 'KDJPG')

    expect(text).toContain('No songs yet.')
    // No summary line claiming zero songs and zero minutes.
    expect(text).not.toContain('0 songs')
  })

  it('numbers songs and names the artists', () => {
    const text = formatChain([entry()], 'KDJPG')

    expect(text).toContain('1. Yellow Submarine — The Beatles')
  })

  it('joins multiple artists', () => {
    const text = formatChain([entry({ track: { ...entry().track, artists: ['A', 'B'] } })], 'X')

    expect(text).toContain('— A, B')
  })

  it('records the linking word, which is the whole game', () => {
    expect(formatChain([entry()], 'X')).toContain('(yellow)')
  })

  it('marks the seed as the start rather than inventing a link', () => {
    const text = formatChain([entry({ isSeed: true, matchedWord: null, via: null })], 'X')

    expect(text).toContain('(the start)')
  })

  it('notes a loose match, so the chain does not look stricter than it was', () => {
    expect(formatChain([entry({ via: 'loose' })], 'X')).toContain('(yellow, close enough)')
  })

  it('notes a match that came from the artist name', () => {
    expect(formatChain([entry({ matchedOn: 'artist' })], 'X')).toContain(
      '(yellow, from the artist)',
    )
  })

  it('distinguishes a host override from an ordinary host addition', () => {
    const overridden = formatChain(
      [entry({ matchedWord: null, wasOverride: true, isSeed: false })],
      'X',
    )
    const added = formatChain(
      [entry({ matchedWord: null, wasOverride: false, isSeed: false })],
      'X',
    )

    expect(overridden).toContain('(host allowed it)')
    expect(added).toContain('(added by the host)')
  })

  it('totals the songs and the running time', () => {
    const chain = [entry({ id: 'a' }), entry({ id: 'b' }), entry({ id: 'c' })]

    // 3 x 160_000ms = 8 minutes.
    expect(formatChain(chain, 'X')).toContain('3 songs, 8 min')
  })

  it('does not pluralise a single song', () => {
    expect(formatChain([entry()], 'X')).toContain('1 song, 3 min')
  })
})

describe('links out to Spotify', () => {
  it('uses the stored URI, so the app opens the exact recording', () => {
    expect(trackDeepLink(entry())).toBe('spotify:track:3n3Ppam7vgaVa1iaRUc9Lp')
  })

  it('offers a web URL for a device with no Spotify app', () => {
    expect(trackWebLink(entry())).toBe(
      'https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp',
    )
  })
})
