-- 0030 — cron mutual-exclusion lease lock (Phase 9 ops)
--
-- Some cron workers move money or a shared on-chain resource and are NOT safe to
-- run concurrently. The sweeper is the motivating case: in 'staking' mode it reads
-- the hot wallet's AVAILABLE Energy and delegates against it per address, so two
-- overlapping runs can both pass the same headroom check and over-commit the
-- stake (later legitimate sweeps then fail). Serverless schedulers double-fire in
-- practice — overlapping ticks, retried invocations, a manual trigger landing on
-- top of a scheduled one.
--
-- We can't use Postgres advisory locks here: the app talks to the DB over PostgREST
-- (a fresh transaction per call), so there is no long-lived session to hold a lock
-- across the many calls a sweep makes. Instead we use a LEASE: a worker claims a
-- named row with a TTL before running and releases it when done. A crashed run's
-- lease simply expires, so a stuck lock self-heals.

create table if not exists public.cron_locks (
  name       text primary key,
  held_until timestamptz,
  holder     text
);

-- Only the security-definer RPCs below touch this table; lock it down otherwise.
alter table public.cron_locks enable row level security;
revoke all on table public.cron_locks from anon, authenticated;

-- ── try_acquire_cron_lock: atomically claim the lease if free/expired ────────
-- Returns true iff THIS caller now holds it. Race-safe in a single statement: the
-- ON CONFLICT row lock serializes concurrent claimants, and the update's WHERE only
-- fires when the current lease is absent or already expired — so a still-held lease
-- yields no updated row and the caller gets false.
create or replace function public.try_acquire_cron_lock(
  p_name        text,
  p_holder      text,
  p_ttl_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acquired boolean;
begin
  insert into public.cron_locks as l (name, held_until, holder)
    values (p_name, now() + make_interval(secs => p_ttl_seconds), p_holder)
    on conflict (name) do update
      set held_until = excluded.held_until,
          holder     = excluded.holder
      where l.held_until is null or l.held_until < now()
    returning true into v_acquired;
  return coalesce(v_acquired, false);
end;
$$;

revoke all on function public.try_acquire_cron_lock(text, text, integer) from public;
grant execute on function public.try_acquire_cron_lock(text, text, integer) to service_role;

-- ── release_cron_lock: drop a lease we still hold ────────────────────────────
-- Holder-scoped: a no-op if someone else now holds the lease (e.g. ours expired and
-- was reclaimed by a newer run), so we never stomp a newer holder.
create or replace function public.release_cron_lock(
  p_name   text,
  p_holder text
) returns void
language sql
security definer
set search_path = public
as $$
  update public.cron_locks
    set held_until = null, holder = null
    where name = p_name and holder = p_holder;
$$;

revoke all on function public.release_cron_lock(text, text) from public;
grant execute on function public.release_cron_lock(text, text) to service_role;
