-- Rooms, and the host's Spotify credentials.
--
-- This lands ahead of the rest of the schema because host auth needs a row to
-- hang an encrypted refresh token off: step 3 cannot be done without it.

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),

  -- Short join code, 5 chars, no ambiguous glyphs. Unique while the room is
  -- live; reusing a retired code later is fine.
  code text not null unique,

  -- lobby -> playing -> paused -> ended
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'paused', 'ended')),

  -- 'live' pushes to the Spotify queue; 'manual' is the non-Premium fallback.
  -- Detected from /v1/me, overridable by the host.
  mode text not null default 'manual' check (mode in ('live', 'manual')),
  mode_is_overridden boolean not null default false,

  -- Rule settings for the room. Validated by zod against RuleSettings before
  -- it ever reaches the engine; jsonb here so adding a setting needs no
  -- migration.
  settings jsonb not null default '{}'::jsonb,

  -- sha256 of the host's cookie token. Only the hash is stored, so a database
  -- leak does not hand anyone host control of a room.
  host_secret_hash text not null,

  -- Spotify identity and capability, from GET /v1/me.
  host_spotify_user_id text,
  host_display_name text,
  host_product text,
  host_scopes text,

  -- AES-256-GCM sealed. Never leaves the server, never reaches a browser.
  host_refresh_token_enc text,
  host_access_token_enc text,
  host_access_token_expires_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.rooms.host_refresh_token_enc is
  'AES-256-GCM sealed refresh token. Server-only; see lib/crypto/seal.ts.';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Two independent barriers, because one is not enough here.
--
-- 1. Row Level Security with *no* policies, on purpose. Everything reaches
--    this table through server routes on a direct Postgres connection as the
--    owner, so the app is unaffected, while anon and authenticated get no
--    rows at all through the Data API.
alter table public.rooms enable row level security;

-- 2. Revoke the table privileges. Supabase's default privileges hand anon and
--    authenticated the full set -- select, insert, update, delete -- on every
--    new table in public. Verified on this database: both roles had all seven
--    privileges on this table the moment it was created. RLS alone would hold,
--    but a single missing `enable row level security` on some future table
--    would then be a public read-write endpoint, so the grants go too.
revoke all privileges on table public.rooms from anon, authenticated;
revoke all privileges on function public.set_updated_at() from anon, authenticated;

-- And stop the next table from inheriting them.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

create trigger rooms_set_updated_at
  before update on public.rooms
  for each row
  execute function public.set_updated_at();
