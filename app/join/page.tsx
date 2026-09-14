import Link from 'next/link'
import { JoinForm } from './join-form'

export const metadata = { title: 'Join a game — Song Chain' }

/**
 * A QR code lands here with the code already filled in, so a passenger only
 * has to type their name.
 */
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<React.JSX.Element> {
  const params = await searchParams
  const raw = params.code
  const code = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 py-8">
      <Link href="/" className="text-paint-dim mb-6 inline-flex items-center text-base">
        Back
      </Link>
      <h1 className="font-display text-paint text-call uppercase">Join a game</h1>
      <p className="text-paint-dim mt-2 mb-8 text-base">
        Ask the driver for the code on their screen.
      </p>
      <JoinForm initialCode={code} />
    </main>
  )
}
