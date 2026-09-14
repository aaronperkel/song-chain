import QRCode from 'qrcode'

/**
 * How everyone else gets in: a code to read aloud, and a QR to hold up.
 *
 * Both are here because a car has both situations -- the person next to you
 * can scan it, the person in the back row cannot see your screen and needs
 * five characters they can hear over the music.
 */
export async function JoinPanel({
  code,
  joinUrl,
}: {
  code: string
  joinUrl: string
}): Promise<React.JSX.Element> {
  // Rendered on the server as SVG: no client library, no canvas, and it
  // scales to whatever the screen is.
  const svg = await QRCode.toString(joinUrl, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    color: { dark: '#10202b', light: '#f2efe6' },
  })

  return (
    <section className="px-4">
      <div className="bg-dusk-raised border-dusk-line rounded-lg border p-4">
        <p className="text-paint-dim text-base">Join at</p>
        <p className="text-paint text-lg">{joinUrl.replace(/^https?:\/\//, '')}</p>

        <p
          className="font-display text-sodium mt-3 text-[3.5rem] leading-none tracking-[0.14em]"
          aria-label={`Join code ${code.split('').join(' ')}`}
        >
          {code}
        </p>

        <div
          className="mt-4 w-40 max-w-full [&>svg]:h-auto [&>svg]:w-full"
          // qrcode generates the SVG; nothing user-supplied reaches it.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </section>
  )
}
