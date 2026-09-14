import { hasSpotifyCredentials } from '@/lib/spotify'
import { SearchLab } from './search-lab'

export const metadata = {
  title: 'search lab — song chain',
}

export default function SearchLabPage(): React.JSX.Element {
  if (!hasSpotifyCredentials()) {
    return (
      <main style={{ fontFamily: 'ui-monospace, monospace', padding: 16, maxWidth: 680 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700 }}>search lab</h1>
        <p>Spotify credentials are not configured.</p>
        <pre style={{ background: '#f4f4f4', padding: 12, fontSize: 12, overflowX: 'auto' }}>
          {[
            '1. https://developer.spotify.com/dashboard -> Create app',
            '2. Redirect URI: http://127.0.0.1:3000/api/auth/spotify/callback',
            '3. Which API: Web API',
            '4. Copy the Client ID and Client Secret into .env.local:',
            '',
            'SPOTIFY_CLIENT_ID=...',
            'SPOTIFY_CLIENT_SECRET=...',
          ].join('\n')}
        </pre>
        <p style={{ fontSize: 12, color: '#666' }}>
          Restart <code>npm run dev</code> after editing <code>.env.local</code>.
        </p>
      </main>
    )
  }

  return (
    <main>
      <SearchLab />
    </main>
  )
}
