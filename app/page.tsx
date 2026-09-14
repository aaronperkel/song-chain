import Link from 'next/link'

/**
 * Two doors: one person hosts, everyone else joins. Nothing else belongs on
 * this screen -- it exists to be got through while the car is pulling away.
 */
export default function Home(): React.JSX.Element {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-between px-5 py-10">
      <div>
        <h1 className="font-display text-paint text-shout uppercase">
          Song
          <br />
          Chain
        </h1>
        <p className="text-paint-dim mt-4 max-w-[30ch] text-lg leading-snug">
          Pass the aux around. Each song has to share a word with the one before it.
        </p>
      </div>

      <div className="mt-12 flex flex-col gap-3">
        <Link
          href="/join"
          className="bg-sodium text-dusk font-display flex items-center justify-center rounded-lg px-5 py-4 text-2xl uppercase"
        >
          Join a game
        </Link>
        <Link
          href="/host"
          className="border-dusk-line text-paint font-display flex items-center justify-center rounded-lg border px-5 py-4 text-2xl uppercase"
        >
          Start a game
        </Link>
        <p className="text-paint-dim mt-2 text-sm leading-snug">
          Starting a game needs Spotify on this phone. Joining needs nothing at all.
        </p>
      </div>
    </main>
  )
}
