/**
 * Every Spotify call in the app goes through this module, with responses
 * parsed into typed values at the boundary. Nothing outside it talks to
 * api.spotify.com, and no Spotify token is ever returned to a browser.
 */
export { getAppToken, resetAppTokenCache } from './appToken'
export { searchTracks, SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX } from './search'
export { SpotifyError, isSpotifyError, readJson, toSpotifyError } from './errors'
export { hasSpotifyCredentials, spotifyCredentials } from './env'
export { toAppTrack } from './types'
export {
  exchangeCode,
  fetchHostProfile,
  getHostAccessToken,
  queueTrack,
  resetHostRefreshCache,
} from './host'
export { authorizeUrl, createPkcePair, createState, redirectUri, HOST_SCOPES } from './pkce'

export type { SpotifyErrorKind } from './errors'
export type { AppTrack, SpotifyTrack, SpotifyTokenResponse } from './types'
export type { SearchOptions } from './search'
export type { HostProfile, HostTokens } from './host'
export type { PkcePair } from './pkce'
