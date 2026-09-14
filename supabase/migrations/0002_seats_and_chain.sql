-- Seats, turn order, and the chain itself.

create table if not exists public.seats (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,

  name text not null check (length(trim(name)) between 1 and 24),

  -- Turn order. Contiguous from 0, but the constraint is deferrable because a
  -- drag-to-reorder rewrites several rows in one statement and would otherwise
  -- collide with itself mid-update.
  position integer not null,

  is_host boolean not null default false,

  -- sha256 of the seat's cookie token, so a leak grants nobody a seat.
  player_token_hash text not null,

  -- Presence, for showing who has dropped off cell service.
  last_seen_at timestamptz not null default now(),

  -- Soft delete: a removed player's picks stay attributed rather than
  -- orphaning rows in the chain.
  removed_at timestamptz,

  created_at timestamptz not null default now(),
  -- Required by the shared set_updated_at trigger below. Without it every
  -- UPDATE on this table fails: renaming a player, reordering seats and
  -- touching last_seen_at are all updates.
  updated_at timestamptz not null default now(),

  constraint seats_room_position_key unique (room_id, position) deferrable initially deferred
);

create index if not exists seats_room_order_idx on public.seats (room_id, position);

create table if not exists public.chain_entries (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,

  position integer not null,

  -- A snapshot of the track, not a reference to one. Spotify titles get
  -- re-released and re-mastered; the chain has to keep saying what was
  -- actually played and what word actually linked it.
  track_id text not null,
  track_uri text not null,
  title text not null,
  artists text[] not null,
  duration_ms integer not null check (duration_ms > 0),
  album_name text,
  album_art_url text,

  -- How this pick linked to the one before. Null on the seed.
  matched_word text,
  matched_on text check (matched_on in ('title', 'artist')),
  via text check (via in ('exact', 'loose')),

  seat_id uuid references public.seats(id) on delete set null,
  is_seed boolean not null default false,
  was_override boolean not null default false,

  queued_to_spotify boolean not null default false,

  -- Null until playback passes it. Drives the queue runway.
  played_at timestamptz,

  -- Idempotency key from the client. This is what makes an offline retry
  -- safe: a submit that succeeded but whose response was lost cannot be
  -- applied twice.
  client_nonce text not null,

  created_at timestamptz not null default now(),

  constraint chain_entries_room_position_key unique (room_id, position),
  constraint chain_entries_room_nonce_key unique (room_id, client_nonce)
);

create index if not exists chain_entries_room_order_idx
  on public.chain_entries (room_id, position);

-- Unplayed entries, for the runway sum.
create index if not exists chain_entries_unplayed_idx
  on public.chain_entries (room_id) where played_at is null;

-- Whose turn it is, and when it started (for the optional turn timer).
alter table public.rooms add column if not exists current_seat_id uuid
  references public.seats(id) on delete set null;
alter table public.rooms add column if not exists turn_started_at timestamptz;

-- Same two barriers as rooms: no rows through the Data API, and no grants to
-- the browser-visible roles. 0001 altered default privileges so new tables do
-- not inherit them, but state it explicitly rather than trusting inheritance.
alter table public.seats enable row level security;
alter table public.chain_entries enable row level security;
revoke all privileges on table public.seats from anon, authenticated;
revoke all privileges on table public.chain_entries from anon, authenticated;

create trigger seats_set_updated_at
  before update on public.seats
  for each row
  execute function public.set_updated_at();
