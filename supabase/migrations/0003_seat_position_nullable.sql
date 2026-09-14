-- A removed seat must give up its position.
--
-- Soft delete and contiguous turn order collide under a plain unique
-- constraint: a removed seat keeps occupying its position, so closing the gap
-- moves an active player onto it and the commit fails with
-- `duplicate key value violates unique constraint "seats_room_position_key"`.
--
-- The obvious fix -- a partial unique index over `removed_at is null` -- is
-- not available: Postgres can defer a *constraint* but not an *index*, and
-- the constraint has to stay deferrable so a drag-to-reorder can rewrite
-- every position in one statement.
--
-- So a removed seat's position becomes null instead. Unique constraints treat
-- nulls as distinct, so any number of removed seats coexist while active
-- seats stay uniquely numbered from 0.
alter table public.seats alter column position drop not null;

comment on column public.seats.position is
  'Turn order, contiguous from 0 for active seats. Null once removed_at is set: a removed seat gives up its place so the gap can close.';

-- Both halves of the invariant, enforced rather than assumed.
alter table public.seats drop constraint if exists seats_position_presence;
alter table public.seats add constraint seats_position_presence check (
  (removed_at is null and position is not null) or
  (removed_at is not null and position is null)
);
