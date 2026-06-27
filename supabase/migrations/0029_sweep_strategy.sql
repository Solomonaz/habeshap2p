-- 0029 — pluggable deposit-gas strategy + pooled/omnibus deposits (Phase 9)
--
-- Live deposits land at per-user derived addresses, but withdrawals pay from the
-- hot wallet, so a cron sweeper consolidates each address into the hot wallet.
-- Those throwaway addresses hold 0 TRX, so the OLD sweeper first SENT ~35 TRX to
-- each address, which was BURNED as Energy on the USDT transfer — real cost on
-- every single deposit. This migration removes that model and lets an admin pick,
-- at runtime, HOW the sweep gets its Energy (or skips sweeping entirely):
--
--   staking — hot wallet freezes TRX for Energy and DELEGATES it to a deposit
--             address just-in-time, sweeps, then reclaims it. TRX locked, not burned.
--   rental  — rent Energy for the deposit address from an external energy market
--             for the few seconds the sweep needs. No TRX locked.
--   pooled  — everyone deposits to ONE shared address (the hot wallet). No per-user
--             address and NO sweep at all, so no gas cost. Deposits are attributed
--             by UNIQUE-AMOUNT MATCHING via the deposit_intents table below.
--
-- The strategy is a column on the platform_settings singleton, written ONLY through
-- set_sweep_strategy (re-checks is_admin, defence in depth — same pattern as 0022).

-- ── strategy columns on the settings singleton ──────────────────────────────
alter table public.platform_settings
  add column if not exists sweep_strategy text not null default 'staking'
    check (sweep_strategy in ('staking', 'rental', 'pooled'));

-- Optional override for the shared pooled deposit address. NULL ⇒ the server falls
-- back to the configured hot-wallet address (TRON_HOT_WALLET_ADDRESS).
alter table public.platform_settings
  add column if not exists pooled_deposit_address text;

-- ── set_sweep_strategy: ADMIN picks the gas strategy ────────────────────────
-- Re-checks is_admin and validates the enum. Upserts the singleton and stamps
-- who/when. p_pooled_address is only meaningful for the 'pooled' strategy; a blank
-- string is normalized to NULL (use the hot-wallet default).
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
  v_is_admin boolean;
  v_current  text;
  v_pooled   text;
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can change the sweep strategy';
  end if;

  if p_strategy is null or p_strategy not in ('staking', 'rental', 'pooled') then
    raise exception 'invalid sweep strategy: %', p_strategy;
  end if;

  -- Guard the pooled → non-pooled transition. In pooled mode the deposit poller
  -- ONLY scans the shared address; the moment we switch away it stops scanning it,
  -- so a deposit a user has already been told to send (a live PENDING intent) would
  -- be stranded on-chain with no poller left to credit it. Refuse the switch while
  -- any such intent is outstanding — wait for it to be paid or to expire first.
  -- (deposit_intents is created below in this same migration; plpgsql resolves the
  -- reference at call time, by which point the table exists.)
  select sweep_strategy into v_current from public.platform_settings where id = true;
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

  insert into public.platform_settings (id, sweep_strategy, pooled_deposit_address, updated_by, updated_at)
    values (true, p_strategy, v_pooled, p_admin, now())
    on conflict (id) do update
      set sweep_strategy         = excluded.sweep_strategy,
          pooled_deposit_address = excluded.pooled_deposit_address,
          updated_by             = excluded.updated_by,
          updated_at             = excluded.updated_at;
end;
$$;

revoke all on function public.set_sweep_strategy(uuid, text, text) from public;
grant execute on function public.set_sweep_strategy(uuid, text, text) to service_role;

-- ── deposit_intents: pooled/omnibus attribution by unique amount ─────────────
-- In pooled mode the chain can't tell whose money arrived at the shared address,
-- so each deposit is fingerprinted by a UNIQUE exact amount the user is told to
-- send. A PENDING intent reserves that amount; the poller matches an inbound
-- transfer to it by amount, credits the user (credit_deposit, idempotent on tx),
-- and marks the intent MATCHED.
create table if not exists public.deposit_intents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id),
  amount_usdt numeric(20, 6) not null check (amount_usdt > 0),
  status      text not null default 'PENDING'
                check (status in ('PENDING', 'MATCHED', 'EXPIRED')),
  tx_hash     text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists deposit_intents_user_idx
  on public.deposit_intents (user_id, created_at);
-- The matching key: at most ONE open intent may claim a given amount. This makes
-- create_deposit_intent's "pick an unused amount" race-safe (insert conflicts).
create unique index if not exists deposit_intents_pending_amount_uniq
  on public.deposit_intents (amount_usdt)
  where status = 'PENDING';
-- Supports the by-amount lookups that span statuses (not just PENDING): the
-- reuse-protection check in create_deposit_intent and the late-match fallback in
-- credit_pooled_deposit. Keeps both equality probes index-driven as MATCHED /
-- EXPIRED rows accumulate over time.
create index if not exists deposit_intents_amount_idx
  on public.deposit_intents (amount_usdt);
-- Supports credit_pooled_deposit's "did we already process this exact transfer?"
-- dedup probe by the recorded tx hash.
create index if not exists deposit_intents_tx_hash_idx
  on public.deposit_intents (tx_hash)
  where tx_hash is not null;

alter table public.deposit_intents enable row level security;
grant select on public.deposit_intents to authenticated;

-- Users may READ their own intents (to render the deposit screen). Nobody writes
-- from the client — only the service-role RPCs below mutate intents.
drop policy if exists deposit_intents_select_own on public.deposit_intents;
create policy deposit_intents_select_own on public.deposit_intents
  for select to authenticated
  using (user_id = auth.uid());

-- ── _expire_stale_intents: lazy housekeeping (no extra cron) ─────────────────
-- Flip any past-deadline PENDING intents to EXPIRED so their amounts free up for
-- reuse. Called from create_deposit_intent and credit_pooled_deposit.
create or replace function public._expire_stale_intents() returns void
language sql
security definer
set search_path = public
as $$
  update public.deposit_intents
    set status = 'EXPIRED'
    where status = 'PENDING' and expires_at < now();
$$;

-- ── create_deposit_intent: reserve a unique amount for a pooled deposit ──────
-- Adds a small random micro-suffix (1..99999 micros ≈ up to 0.099999 USDT) to the
-- requested base amount until it finds an amount with no live PENDING intent, then
-- inserts it with a 30-minute window. Returns the new intent row.
create or replace function public.create_deposit_intent(
  p_user        uuid,
  p_base_amount numeric
) returns public.deposit_intents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric(20, 6);
  v_row    public.deposit_intents%rowtype;
  v_try    integer := 0;
begin
  if p_base_amount is null or p_base_amount <= 0 then
    raise exception 'deposit base amount must be positive (got %)', p_base_amount;
  end if;

  perform public._expire_stale_intents();

  -- Try a handful of random fingerprints; the partial unique index guarantees
  -- two open intents can never share an amount, so a conflict just means retry.
  loop
    v_try := v_try + 1;
    if v_try > 50 then
      raise exception 'could not allocate a unique deposit amount, try again';
    end if;

    -- base + (1..99999) micros, rounded to 6dp.
    v_amount := round(p_base_amount + (floor(random() * 99999) + 1) / 1000000.0, 6);

    -- Skip any amount that is still "owned": a live PENDING intent, OR ANY intent
    -- (any status) created within the settlement-protection window. Handing the
    -- same amount to a DIFFERENT user too soon is the misattribution bug — the
    -- first user's transfer can settle LATE (after their 30-minute UX window) and
    -- would then be matched to the second user. This window MUST be ≥ the
    -- late-match window in credit_pooled_deposit below (both 1 day), so that at
    -- most one user can ever own a given amount at a time.
    if exists (
      select 1 from public.deposit_intents
      where amount_usdt = v_amount
        and (status = 'PENDING' or created_at > now() - interval '1 day')
    ) then
      continue;
    end if;

    begin
      insert into public.deposit_intents (user_id, amount_usdt, expires_at)
        values (p_user, v_amount, now() + interval '30 minutes')
        returning * into v_row;
      return v_row;
    exception when unique_violation then
      -- A concurrent PENDING intent grabbed this amount first — pick a new suffix.
      null;
    end;
  end loop;
end;
$$;

revoke all on function public.create_deposit_intent(uuid, numeric) from public;
grant execute on function public.create_deposit_intent(uuid, numeric) to service_role;

-- ── credit_pooled_deposit: match an inbound transfer to a PENDING intent ─────
-- Called by the deposit poller for each confirmed transfer to the pooled address.
-- Finds the intent whose amount equals the transfer, credits that user
-- (credit_deposit dedupes on tx hash), and marks the intent MATCHED.
--
-- Returns a STATUS the poller acts on:
--   'credited'  — newly credited a user this call.
--   'duplicate' — this exact transfer was already processed, or a concurrent poll
--                 holds the matching intent's lock. Benign no-op.
--   'unmatched' — a confirmed transfer that matches NO deposit intent. The money
--                 is real but unattributable (wrong amount, or a deposit with no
--                 intent). The poller must SURFACE this for manual reconciliation
--                 rather than silently dropping it.
-- (Returns text, not boolean: 'duplicate' must be distinguishable from 'unmatched'
-- so the poller never cries wolf on re-polled, already-credited transfers.)
drop function if exists public.credit_pooled_deposit(text, numeric);
create function public.credit_pooled_deposit(
  p_tx_hash text,
  p_amount  numeric
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent   public.deposit_intents%rowtype;
  v_credited boolean;
begin
  if p_tx_hash is null or length(btrim(p_tx_hash)) = 0 then
    raise exception 'tx hash is required';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'deposit amount must be positive (got %)', p_amount;
  end if;

  perform public._expire_stale_intents();

  -- Find the intent that reserved this exact amount and lock it so two concurrent
  -- polls can't double-credit. Prefer a live PENDING intent; fall back to one that
  -- EXPIRED recently (a transfer that settled just after the 30-minute UX window)
  -- so the depositor is still credited rather than silently stranded. The 1-day
  -- match window equals create_deposit_intent's reuse-protection window, which
  -- guarantees at most ONE user owns a given amount within it — so a late transfer
  -- can never be misattributed to a different, newer user.
  select * into v_intent
    from public.deposit_intents
    where amount_usdt = p_amount
      and (
        status = 'PENDING'
        or (status = 'EXPIRED' and created_at > now() - interval '1 day')
      )
    order by (status = 'PENDING') desc, created_at desc
    limit 1
    for update skip locked;

  if not found then
    -- No live intent matched. Disambiguate before alerting: is a matching intent
    -- merely locked by a concurrent poll right now, or did we already credit this
    -- exact transfer (idempotent re-poll)? Both are benign duplicates; only a
    -- genuine absence of any matching intent means stranded, unattributable funds.
    --
    -- Order matters: check the matching-intent first, the recorded tx hash second.
    -- A crediting poll flips status→MATCHED and sets tx_hash in ONE atomic update,
    -- so if the matching intent is no longer PENDING (this check fails) that update
    -- has committed and its tx_hash is already visible to the next check — closing
    -- the race where a concurrent same-transfer poll would falsely look unmatched.
    if exists (
      select 1 from public.deposit_intents
      where amount_usdt = p_amount
        and (
          status = 'PENDING'
          or (status = 'EXPIRED' and created_at > now() - interval '1 day')
        )
    ) then
      return 'duplicate';   -- a matching intent is locked by a concurrent poll
    end if;
    if exists (
      select 1 from public.deposit_intents where tx_hash = btrim(p_tx_hash)
    ) then
      return 'duplicate';   -- this exact transfer was already matched
    end if;
    return 'unmatched';     -- nobody reserved this amount → needs reconciliation
  end if;

  v_credited := public.credit_deposit(v_intent.user_id, p_tx_hash, p_amount);

  -- Mark the intent matched regardless of credit_deposit's dedupe result: the
  -- amount has been accounted for and must not match a second transfer.
  update public.deposit_intents
    set status = 'MATCHED', tx_hash = btrim(p_tx_hash)
    where id = v_intent.id;

  -- credit_deposit dedupes on tx hash; a false result means this transfer was
  -- already credited in a prior run, so report it as a duplicate, not a credit.
  return case when v_credited then 'credited' else 'duplicate' end;
end;
$$;

revoke all on function public.credit_pooled_deposit(text, numeric) from public;
grant execute on function public.credit_pooled_deposit(text, numeric) to service_role;
