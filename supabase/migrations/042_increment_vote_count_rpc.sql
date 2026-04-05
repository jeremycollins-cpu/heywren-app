-- Atomic increment/decrement for community signal vote counts.
-- Avoids read-modify-write race conditions on concurrent votes.
create or replace function increment_vote_count(signal_id uuid, delta int)
returns void
language sql
as $$
  update community_signals
  set vote_count = greatest(0, coalesce(vote_count, 0) + delta)
  where id = signal_id;
$$;
