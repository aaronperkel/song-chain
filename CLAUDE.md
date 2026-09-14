@AGENTS.md

# Song Chain

A car-trip word game. One phone hosts and owns Spotify playback; everyone else joins from
their own phone with no Spotify account and no login. Each song's title must share a word
with the previous one ("Goodbye Yellow Brick Road" -> "Yellow Submarine"). Cooperative,
endless, no lose condition. The chain *is* the queue you are listening to.

## Status

Steps 1-5 are done, verified and pushed, and production is live. The game is playable end to end.

| Step | What | State |
| --- | --- | --- |
| 1 | Rules engine, `lib/rules/` | done — 166 tests, 99% statements |
| 2 | Search proxy + audit page | done — verified against 453 real Spotify titles |
| 3 | Host PKCE auth + queue write | done — verified with live `POST /v1/me/player/queue` |
| 4 | Rooms, codes, seats, turns, realtime | done — 290 hermetic + 58 db tests, full HTTP walkthrough |
| — | Deploy to production | done — live, redirect URI registered |
| 5 | Runway, settings, host controls, manual mode | done — 354 hermetic + 80 db tests |
| 6 | Polish | **next** |

## Production

Live at **https://song-chain-lemon.vercel.app** (stable alias; the per-deploy
`song-chain-<hash>-aaronperkel.vercel.app` URLs change every time and are useless to Spotify).
`APP_ORIGIN` is set in production to that origin, stored as a **config** value rather than a
secret so it can be read back and checked — it has to match Spotify byte for byte, and a value
you cannot read is a value you cannot verify. Deploy with `npx vercel deploy --prod`; the CLI
is not a dependency and not installed globally.

Deploy was pulled ahead of the original build order deliberately. **Hosting from a phone cannot
be tested locally at all.** Spotify only accepts a redirect URI that is HTTPS or a loopback
literal (`http://127.0.0.1:PORT`, `http://[::1]:PORT`) — `localhost` and LAN IPs like
`192.168.1.184` are rejected and cannot even be registered. So in dev the host must sit on the
laptop at `http://127.0.0.1:3000`. But this game is played in a car, and there is no laptop in
a car: phone-hosting is the real deployment model, and everything left in step 5 is host-screen
work. Build it against a configuration that can actually be used.

Verified in production: room creation works, and `/api/auth/spotify/login` redirects with
`redirect_uri=https://song-chain-lemon.vercel.app/api/auth/spotify/callback` and the
`user-read-private` scope present.

`https://song-chain-lemon.vercel.app/api/auth/spotify/callback` is registered in the Spotify
dashboard alongside the local `http://127.0.0.1:3000/api/auth/spotify/callback` entry, and
Spotify was confirmed to accept it (the authorize URL renders the login page rather than
`INVALID_CLIENT: Invalid redirect URI`).

Still unconfirmed, because it needs a real Premium login on a phone: open `/host`, connect
Spotify, check the room reports `mode=live`, queue one track for real.

Dev and production share one Supabase database, so the migrations in `supabase/migrations/` are
already applied — no separate production migration. Preview deployments get a fresh URL each
time and so cannot complete Spotify auth; only production works.

## Step 5 — what was built

- **Runway** (`lib/rooms/playback.ts`, `POST /api/rooms/[id]/playback`). The host polls every
  10s, `visibilitychange`-aware, with the queue endpoint read every 5th poll. `resolvePlayback`
  is pure and deliberately conservative: it marks an entry played only when playback has
  demonstrably moved *past* it, and marks nothing at all when it cannot locate the chain.
  An empty Spotify queue never drains the runway — it reads the same whether the chain finished
  or the host just opened a fresh device.
- **Settings UI** (`lib/rooms/settings-schema.ts`, `PATCH /api/rooms/[id]/settings`). One
  definition drives the Zod schema, the buttons and the copy, with a test asserting every button
  maps to a value the server accepts. The write merges into the JSON column so one change cannot
  blank the others.
  **Seven settings, not eight.** `allowRepeatSongs` is typed as the literal `false` throughout
  the rules engine, so there is no honest control to offer; Aaron chose to omit it rather than
  show a switch that cannot move or widen the engine's type. Lifting that pin means changing
  `lib/rules/types.ts`, gating the `duplicate-song` check in `validate.ts`, and accepting that
  duplicate detection also catches remasters.
- **Host controls** (`POST /api/rooms/[id]/host`): skip, undo, pause, resume, end. Undo and
  override had both been half-built since step 4 and unreachable — `removeLastEntry` had no
  caller and the picks route accepted `override: true` that no client ever sent. Ending is
  final and asks first.
- **Manual mode**: chain entries deep-link to Spotify (`open.spotify.com`, not the bare
  `spotify:` URI, which silently does nothing on a phone without the app), a text export that
  carries the linking words, and a playlist write behind incremental `playlist-modify-private`
  consent via `/api/auth/spotify/login?scopes=playlist`. Chunks are sent **in sequence**: the
  order is the game, and parallel chunks would shuffle it.

Verified against production with a real room: settings merge and reject bad input, host actions
are 403 without the cookie, pause blocks picks with 409, end clears the turn and is final.

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
npm test          # 354 hermetic tests — no network, no database, no credentials
npm run test:db   # 80 tests against the real Supabase database
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
- **On a second machine, iCloud evicts `node_modules` and `npm test`/`npm run build` hang
  forever.** This is not a cache problem and there is nothing to clear. iCloud leaves *dataless
  placeholders*: the files list normally and `stat -f%z` reports a real size, but `stat -f%b`
  reports **0 blocks**, so every read blocks on a per-file download. `du -sh node_modules`
  showing ~21M instead of ~500M is the tell. Fix: `rm -rf node_modules && npm ci`, then mark the
  build dirs so iCloud stops touching them —
  `xattr -w 'com.apple.fileprovider.ignore#P' 1 node_modules .next`. Both are already set on
  Aaron's work machine.
- **Deleting `.next` breaks `typecheck` until you build again.** Next 16 generates the global
  `LayoutProps`/`PageProps` types into `.next/types`, which `tsconfig.json` includes, so a clean
  `.next` makes `app/layout.tsx` fail with `TS2304: Cannot find name 'LayoutProps'`. Run
  `npm run build` first; the error is an artifact of the clean, not a real type error.
- **Supabase free tier pauses after ~7 days idle.** A dead app after a quiet week is this,
  not a bug.
- **RLS plus revoked grants** are two independent barriers on every table, because Supabase
  grants `anon` full DML on new tables by default. Any new migration must revoke too.
- **A tsconfig `exclude` glob cannot use a character class.** tsconfig globs support only `*`,
  `?` and `**/`, so `"**/* [0-9].ts"` matched literally and excluded nothing — the iCloud
  conflict copies it was written for were breaking `typecheck` for months. It is `"**/* ?.ts"`
  now. Verified with the conflict files on disk: `[0-9]` fails, `?` passes.
- `.gitignore` needs its own pattern for the conflict copies: `/.next/` does not match
  `.next 2/`, so one turns up as untracked after a synced build.
- `next dev` rewrites `AGENTS.md` — put durable instructions here in `CLAUDE.md` instead.

## Commits

Conventional commits, pushed to `origin main` after every verified sub-step. Commit
frequently. Finish and verify each step before starting the next; do not scaffold ahead.
