-- Realtime Broadcast authorisation.
--
-- Realtime Authorization is on by default, and without a policy on
-- realtime.messages a browser subscribing with the publishable key receives
-- nothing at all. (The July 2026 lockdown of the `realtime` schema blocks
-- creating objects there; adding a policy to this table is still allowed --
-- verified against this project.)
--
-- The model is server-writes / clients-subscribe:
--
--   * SELECT is granted to anon, so a guest's phone can receive room events
--     with nothing but the publishable key. No Spotify account, no login.
--   * INSERT is deliberately *not* granted, so a client cannot forge an
--     event. Every broadcast comes from a server route over REST with the
--     secret key, which bypasses RLS.
--
-- The capability is therefore possession of the room's UUID, which is what
-- the topic is named after: v4, unguessable, and handed only to people who
-- were given the join code or QR. Anyone holding it can listen in on which
-- songs are being picked. For a party game that is an acceptable trade, and
-- it is the honest description of what this policy does -- not a claim that
-- rooms are private. Tightening it further means minting a room-scoped JWT
-- per seat and testing `realtime.topic()` against its claim, which is the
-- upgrade path if this ever carries anything worth hiding.
create policy "anon may receive room broadcasts"
  on realtime.messages
  for select
  to anon
  using (realtime.topic() like 'room:%');
