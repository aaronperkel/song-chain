-- A seat that nobody's phone holds.
--
-- The driver is playing too -- they just cannot look at a screen. They say the
-- song out loud and whoever is quickest types it in. That pick belongs to the
-- driver's seat, not to the passenger who did the typing, so the chain keeps
-- saying who actually thought of it.
--
-- The column is about *who may pick for this seat*, nothing more. It does not
-- revoke the seat's token: a phone that comes back from a dead battery still
-- holds its seat, and turning the flag off again is a plain flip with nothing
-- to re-issue.
alter table public.seats add column if not exists has_phone boolean not null default true;

comment on column public.seats.has_phone is
  'False when no device holds this seat -- the driver, or a phone that died. Anyone else in the room may pick on its behalf when its turn comes. True by default: every seat taken through /join is taken by a browser.';

-- No grants to revoke: this alters an existing table rather than creating one,
-- and `seats` already denies anon and authenticated everything (0002).
