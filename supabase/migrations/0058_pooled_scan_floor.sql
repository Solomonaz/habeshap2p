-- 0058 — pooled deposit scan floor (clean cutover between sweep strategies)
--
-- THE BUG THIS FIXES
-- The pooled poller reads the recent inbound USDT transfers to the shared address
-- (the hot wallet) and matches each by exact amount to a deposit_intent. It had no
-- lower time bound, so it re-read the WHOLE recent history of that address. In the
-- burn/staking/rental strategies, user deposits are swept INTO the hot wallet, and
-- test transfers land there too — permanent on-chain records. The moment pooled mode
-- turns on, the poller sees all that pre-pooled history, finds no matching intent,
-- and flags each as "unmatched". Burn didn't leave anything incomplete (users were
-- credited at their derived addresses); the pooled scanner simply had no cutover line.
--
-- THE FIX
-- Stamp the instant pooled mode becomes active (or its address changes) as
-- `pooled_scan_from`. The poller only considers transfers at/after that instant —
-- everything before the switch is out of scope forever. (The poller also skips any
-- transfer whose SENDER is one of our own addresses — a sweep/internal move is never
-- a user deposit — but that guard lives in application code; this migration provides
-- the cutover watermark.)

-- ── the watermark column ─────────────────────────────────────────────────────
alter table public.platform_settings
  add column if not exists pooled_scan_from timestamptz;

comment on column public.platform_settings.pooled_scan_from is
  'The instant pooled deposit scanning started. The pooled poller ignores every '
  'on-chain transfer before this — so switching INTO pooled mode never resurfaces '
  'pre-pooled history (burn/staking sweeps, old test sends) as unmatched deposits.';

-- ── set_sweep_strategy: same contract as 0039, now stamps the scan floor ──────
-- Stamp pooled_scan_from = now() when the result is pooled AND this is a genuine
-- transition (was not pooled before) OR the pooled address changed. Re-saving the
-- same pooled settings does NOT move the floor forward (which would hide recent,
-- legitimate deposits). The pending-intent guard on switching AWAY is unchanged.
create or replace function public.set_sweep_strategy(
  p_admin          uuid,
  p_strategy       text,
  p_pooled_address text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin  boolean;
  v_current   text;
  v_prev_addr text;
  v_prev_floor timestamptz;
  v_pooled    text;
  v_floor     timestamptz;
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can change the sweep strategy';
  end if;

  if p_strategy is null or p_strategy not in ('staking', 'rental', 'burn', 'pooled') then
    raise exception 'invalid sweep strategy: %', p_strategy;
  end if;

  select sweep_strategy, pooled_deposit_address, pooled_scan_from
    into v_current, v_prev_addr, v_prev_floor
    from public.platform_settings where id = true;

  if v_current = 'pooled' and p_strategy <> 'pooled' then
    if exists (
      select 1 from public.deposit_intents
      where status = 'PENDING' and expires_at > now()
    ) then
      raise exception
        'cannot switch off pooled mode while deposit intents are still pending; '
        'wait for them to be paid or to expire, then change the strategy';
    end if;
  end if;

  v_pooled := nullif(btrim(coalesce(p_pooled_address, '')), '');

  -- Fresh cutover on a genuine entry into pooled mode, or when the shared address
  -- changes (a new address has its own, unrelated history). Otherwise keep the
  -- existing floor so we never retroactively hide deposits already in scope.
  if p_strategy = 'pooled'
     and (v_current is distinct from 'pooled'
          or v_prev_addr is distinct from v_pooled
          or v_prev_floor is null) then
    v_floor := now();
  else
    v_floor := v_prev_floor;
  end if;

  insert into public.platform_settings
      (id, sweep_strategy, pooled_deposit_address, pooled_scan_from, updated_by, updated_at)
    values (true, p_strategy, v_pooled, v_floor, p_admin, now())
    on conflict (id) do update
      set sweep_strategy         = excluded.sweep_strategy,
          pooled_deposit_address = excluded.pooled_deposit_address,
          pooled_scan_from       = excluded.pooled_scan_from,
          updated_by             = excluded.updated_by,
          updated_at             = excluded.updated_at;
end;
$$;

revoke all on function public.set_sweep_strategy(uuid, text, text) from public;
grant execute on function public.set_sweep_strategy(uuid, text, text) to service_role;

-- ── backfill: close the current live pooled state ────────────────────────────
-- Pooled mode is already active with no floor set, so the poller has been re-reading
-- pre-pooled history. Draw the line NOW: everything already on-chain is out of scope,
-- and only deposits from this point forward are scanned.
update public.platform_settings
  set pooled_scan_from = now()
  where id = true and sweep_strategy = 'pooled' and pooled_scan_from is null;
