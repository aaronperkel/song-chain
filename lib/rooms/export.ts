import type { StoredEntry } from './entry'

/**
 * The chain as text you can paste into a message.
 *
 * This is what a manual-mode room has instead of a Spotify queue, and it is
 * also the only thing that outlives the room: rooms are ephemeral, and after a
 * long drive the chain is the thing people actually want to keep.
 *
 * The linking word is included because it *is* the game. A bare track list is
 * a playlist; the words are what made it a chain.
 */
export function formatChain(chain: readonly StoredEntry[], code: string): string {
  const lines = [`Song Chain — ${code}`, '']

  if (chain.length === 0) {
    lines.push('No songs yet.')
    return lines.join('\n')
  }

  chain.forEach((entry, index) => {
    const number = String(index + 1).padStart(2, ' ')
    const artists = entry.track.artists.join(', ')
    lines.push(`${number}. ${entry.track.title} — ${artists}${linkNote(entry)}`)
  })

  lines.push('', summary(chain))
  return lines.join('\n')
}

/** How this song joined the chain, in the fewest words that stay honest. */
function linkNote(entry: StoredEntry): string {
  if (entry.isSeed) return '  (the start)'
  if (entry.matchedWord === null) {
    return entry.wasOverride ? '  (host allowed it)' : '  (added by the host)'
  }

  const via = entry.via === 'loose' ? ', close enough' : ''
  const from = entry.matchedOn === 'artist' ? ', from the artist' : ''
  return `  (${entry.matchedWord.toLowerCase()}${via}${from})`
}

function summary(chain: readonly StoredEntry[]): string {
  const totalMs = chain.reduce((sum, entry) => sum + entry.track.durationMs, 0)
  const minutes = Math.round(totalMs / 60_000)
  const songs = chain.length === 1 ? '1 song' : `${String(chain.length)} songs`
  return `${songs}, ${String(minutes)} min`
}

/**
 * A `spotify:` URI opens the Spotify app directly where one is installed.
 *
 * Manual-mode rooms never reach the queue API, so this deep link is the only
 * route from the chain to actually hearing the song.
 */
export function trackDeepLink(entry: StoredEntry): string {
  return entry.track.uri
}

/** The web fallback, for a device with no Spotify app to catch the URI. */
export function trackWebLink(entry: StoredEntry): string {
  return `https://open.spotify.com/track/${entry.track.id}`
}
