import type { StoredEntry } from '@/lib/rooms/entry'
import { trackWebLink } from '@/lib/rooms/export'

/**
 * The chain, drawn as a route.
 *
 * Songs are stops and the shared word is the junction between them, because
 * that word *is* the game. It carries the one bright colour in the interface
 * so the thing everyone argues about is the thing you can see from across
 * the car.
 */
export function ChainRoute({
  chain,
  nowPlayingId,
  linkTracks = false,
}: {
  chain: readonly StoredEntry[]
  nowPlayingId?: string | null
  /**
   * Manual mode only. A manual room never reaches the queue API, so opening
   * the song yourself is the only route from the chain to hearing it. Live
   * rooms leave it off: the song is already queued, and tapping one would
   * hijack the playback everyone is listening to.
   */
  linkTracks?: boolean
}): React.JSX.Element {
  if (chain.length === 0) {
    return (
      <p className="text-paint-dim px-4 py-8 text-base">
        No songs yet. The host starts the chain with the first one.
      </p>
    )
  }

  return (
    <ol className="px-4">
      {chain.map((entry, index) => (
        <li key={entry.id}>
          {index > 0 ? <Junction entry={entry} /> : null}
          <Stop
            entry={entry}
            isFirst={index === 0}
            isNowPlaying={entry.id === nowPlayingId}
            linked={linkTracks}
          />
        </li>
      ))}
    </ol>
  )
}

function Junction({ entry }: { entry: StoredEntry }): React.JSX.Element {
  if (entry.matchedWord === null) {
    return (
      <div className="flex items-center gap-3 py-1 pl-[7px]">
        <span className="bg-dusk-line h-7 w-px" aria-hidden />
        <span className="text-paint-dim text-sm">
          {entry.wasOverride ? 'host allowed this one' : 'added by the host'}
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 py-1 pl-[7px]">
      <span className="bg-dusk-line h-7 w-px" aria-hidden />
      <span className="font-display text-sodium text-xl leading-none">
        {entry.matchedWord.toLowerCase()}
      </span>
      {entry.via === 'loose' ? (
        <span className="text-paint-dim text-xs">close enough</span>
      ) : null}
      {entry.matchedOn === 'artist' ? (
        <span className="text-paint-dim text-xs">from the artist</span>
      ) : null}
    </div>
  )
}

function Stop({
  entry,
  isFirst,
  isNowPlaying,
  linked,
}: {
  entry: StoredEntry
  isFirst: boolean
  isNowPlaying: boolean
  linked: boolean
}): React.JSX.Element {
  const played = entry.playedAt !== null

  return (
    <div className="flex gap-3">
      <span
        className={[
          'mt-[6px] h-[15px] w-[15px] shrink-0 rounded-full border-2',
          isNowPlaying
            ? 'border-sodium bg-sodium'
            : played
              ? 'border-dusk-line bg-dusk-line'
              : 'border-paint-dim bg-dusk',
        ].join(' ')}
        aria-hidden
      />
      <div className={`min-w-0 pb-1 ${played && !isNowPlaying ? 'opacity-55' : ''}`}>
        {linked ? (
          <a
            // The https URL rather than the spotify: URI: it opens the app
            // where one is installed and the web player where none is, while
            // a bare spotify: link silently does nothing on a phone without
            // Spotify -- which in a manual-mode room is a real possibility.
            href={trackWebLink(entry)}
            target="_blank"
            rel="noreferrer"
            // 44px minimum, and the whole title is the target.
            className="text-paint flex min-h-[44px] items-center text-lg leading-tight font-medium underline decoration-dotted underline-offset-4"
          >
            {entry.track.title}
          </a>
        ) : (
          <p className="text-paint text-lg leading-tight font-medium">{entry.track.title}</p>
        )}
        <p className="text-paint-dim truncate text-sm">
          {entry.track.artists.join(', ')}
          {isFirst ? ' — the start' : ''}
          {entry.seatName !== null && !isFirst ? ` — ${entry.seatName}` : ''}
        </p>
        {isNowPlaying ? (
          <p className="text-sodium text-sm">playing now</p>
        ) : null}
        {!entry.queuedToSpotify && !played ? (
          <p className="text-paint-dim text-xs">not sent to Spotify</p>
        ) : null}
      </div>
    </div>
  )
}
