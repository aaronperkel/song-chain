@AGENTS.md

# Song Chain

A car-trip word game. One phone hosts and owns Spotify playback; everyone else joins from
their own phone with no Spotify account and no login. Each song's title must share a word
with the previous one ("Goodbye Yellow Brick Road" -> "Yellow Submarine"). Cooperative,
endless, no lose condition. The chain *is* the queue you are listening to.

## Status

Steps 1-4 of the build order are done, verified and pushed. The game is playable end to end.

| Step | What | State |
| --- | --- | --- |
| 1 | Rules engine, `lib/rules/` | done — 166 tests, 99% statements |
| 2 | Search proxy + audit page | done — verified against 453 real Spotify titles |
| 3 | Host PKCE auth + queue write | done — verified with live `POST /v1/me/player/queue` |
| 4 | Rooms, codes, seats, turns, realtime | done — 290 hermetic + 58 db tests, full HTTP walkthrough |
| — | **Deploy to production** | **next — blocking, see below** |
| 5 | Runway, settings, host controls, manual mode | not started |
| 6 | Polish | not started |

## Start here: deploy to production

This is out of the original build order (deploy was step 6) and it is deliberate. **Hosting
from a phone cannot be tested locally at all.** Spotify only accepts a redirect URI that is
HTTPS or a loopback literal (`http://127.0.0.1:PORT`, `http://[::1]:PORT`) — `localhost` and
LAN IPs like `192.168.1.184` are rejected and cannot even be registered. So in dev the host
must sit on the laptop at `http://127.0.0.1:3000`. But this game is played in a car, and
there is no laptop in a car: phone-hosting is the real deployment model, and everything left
in step 5 is host-screen work. Build it against a configuration that can actually be used.

1. `vercel deploy --prod` (project is already linked: `aaronperkel/song-chain`).
2. Read the production URL from the output. Then set the origin — `lib/api/origin.ts` prefers
   `APP_ORIGIN` over the host header, and the redirect URI must match Spotify byte for byte:
   `vercel env add APP_ORIGIN production` -> `https://<domain>` (no trailing slash).
3. Ask Aaron to add `https://<domain>/api/auth/spotify/callback` to the Spotify dashboard's
   redirect URIs (developer.spotify.com/dashboard -> the app -> Settings). Keep the existing
   `http://127.0.0.1:3000/api/auth/spotify/callback` entry for local work.
4. Redeploy so `APP_ORIGIN` takes effect, then verify on a phone: open `/host`, connect
   Spotify, confirm the room reports `mode=live`, queue one track for real.

Production already has `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `TOKEN_ENC_KEY` and the
Supabase vars. `APP_ORIGIN` is the only one missing. Dev and production share one Supabase
database, so the migrations in `supabase/migrations/` are already applied — no separate
production migration. Preview deployments get a fresh URL each time and so cannot complete
Spotify auth; only production works.

## Step 5

- **Runway**: host polls `currently-playing` every ~10s, `visibilitychange`-aware, reconciled
  against `GET /v1/me/player/queue` roughly every 5th poll. Server advances `played` and
  broadcasts. Shown on every device: **Queued: 47 min (12 songs)**.
- **Settings UI**, host-only, for all eight room settings in `lib/rules/settings.ts`
  (`matchScope`, `artistCooldown`, `stopwords`, `looseForms`, `numerals`, `wordReuse`,
  `allowRepeatSongs`, `turnTimer`). Applies to subsequent picks only.
- **Host controls**: skip turn, undo last pick, override a rejection (recorded on the entry),
  pause, end. Undo copy must stay honest: Spotify has no remove-from-queue API, so the track
  may still play and the user has to skip it in Spotify.
- **Manual mode** (non-Premium or no active device): search and validation are unchanged
  because they use Client Credentials. Render `spotify:track:` deep links, export the chain,
  optionally write a playlist after incremental `playlist-modify-private` re-auth.

## Step 6

Mobile-first pass (44px+ targets, one-handed), PWA manifest, `navigator.wakeLock` on the host
screen — note it is secure-context only, so it will work in production and not over LAN http.
`prefers-reduced-motion`.

## Architecture constraints — do not deviate without flagging

These come from Aaron's brief and are load-bearing, not preferences.

1. **Only the host authenticates with Spotify.** Guests need zero Spotify account and zero
   login. The queue endpoint requires Premium and dev-mode apps cap at 25 users.
2. **Search runs server-side via Client Credentials**, never the host's user token.
3. Host auth is Authorization Code + PKCE. The refresh token is stored server-side,
   encrypted at rest (`lib/crypto/seal.ts`, AES-256-GCM).
4. **No Spotify token ever reaches a browser.** Queue writes go through a server route.
5. **The server is authoritative for turn order and validation.** Always re-validate a pick
   server-side by re-fetching the track from Spotify by ID. Never trust client word matching.
6. `explain()` returning which word matched and why is a hard requirement, not a nicety — it
   exists so nobody argues about a rejection in the car.
7. Zod validates every API route input. Strict TypeScript, no `any`. All Spotify calls live
   in `lib/spotify/`.

## Verify

```
npm test          # 290 hermetic tests — no network, no database, no credentials
npm run test:db   # 58 tests against the real Supabase database
npm run typecheck
npm run lint      # run it bare; piping into `tail` inside an && chain has hidden a real failure
npm run build     # not while `next dev` is running (see iCloud below)
```

## Hard-won gotchas

- **Secure-context APIs break guest phones.** Guests load the app over plain http, where
  `crypto.randomUUID`, `crypto.subtle`, `navigator.clipboard` and `wakeLock` are all
  undefined. `crypto.getRandomValues` is fine. This shipped as a dead Add button; see
  `lib/player/nonce.ts`. Read the dev server log before concluding anything about a dead
  button — the stack trace was sitting in it.
- **Idempotency before authorization.** In `app/api/rooms/[id]/picks/route.ts` the
  `client_nonce` replay check must run *before* the seat and turn checks. A retry after a
  lost response is not out of turn; the turn moved on *because* the pick landed. Dead cell
  service is the failure this app is specified to survive.
- **Spotify caps search `limit` at 10**, undocumented — 20 returns 502. See
  `SEARCH_LIMIT_MAX` in `lib/spotify/search.ts`.
- **`product` needs the `user-read-private` scope**, or Premium hosts get detected as manual.
- **`~/Documents` is iCloud-synced**, so `.next` output generates `" 2"` conflict copies that
  break `typecheck`. `tsconfig.json` excludes the pattern; don't run `build` while `dev` is
  live. Moving the repo out of iCloud is the real fix and is Aaron's call.
- **Supabase free tier pauses after ~7 days idle.** A dead app after a quiet week is this,
  not a bug.
- **RLS plus revoked grants** are two independent barriers on every table, because Supabase
  grants `anon` full DML on new tables by default. Any new migration must revoke too.
- `next dev` rewrites `AGENTS.md` — put durable instructions here in `CLAUDE.md` instead.

## Commits

Conventional commits, pushed to `origin main` after every verified sub-step. Commit
frequently. Finish and verify each step before starting the next; do not scaffold ahead.
