import type { MetadataRoute } from 'next'

/**
 * Installing the app to a home screen.
 *
 * This matters most for the host: the game runs for the length of a drive on
 * a phone propped up in the car, and a standalone window keeps the browser
 * chrome -- and the address bar that eats the top of a short screen -- out of
 * the way. Guests get it too, though most of them arrive from a QR code and
 * leave when the trip ends.
 *
 * Portrait only, and the same dusk field as the interface, so the splash and
 * the first paint are the same colour rather than a white flash in a dark car.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Song Chain',
    // Short enough to survive a home screen without an ellipsis.
    short_name: 'Song Chain',
    description: 'A car-trip word game played through Spotify.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#10202b',
    theme_color: '#10202b',
    categories: ['games', 'music'],
    icons: [
      // Full-bleed dusk with the mark inside the 80% safe zone, so one file
      // serves both the plain and the masked shape.
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
