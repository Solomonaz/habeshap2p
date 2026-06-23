-- 0021 — admin-configurable trade limits + merchant bond (Phase 9)
--
-- Migration 0011 introduced two safety knobs as HARDCODED constants:
--   • new-user per-order trade limits (100 / 1,000 / 10,000 USDT tiers), and
--   • the merchant collateral bond minimum (500 USDT).
-- This migration lifts both onto the platform_settings singleton so an admin can
-- tune them from the console — set looser/tighter caps, change the tier
-- thresholds, or raise/lower the bond — without a code deploy.
--
--   min_merchant_bond        — USDT a user must lock to gain merchant standing.
--   trade_limit_new          — per-order cap for a brand-new account (0 trades).
--   trade_limit_active       — cap once they reach `tier_active_trades` trades.
--   trade_limit_established  — cap once they reach `tier_established_trades`.
--   tier_active_trades       — completed trades needed for the ACTIVE tier.
--   tier_established_trades  — completed trades needed for the ESTABLISHED tier.
--
-- A cap column may be NULL, meaning "unlimited" for that tier (merchants are
-- always unlimited regardless). The values are written ONLY through
-- set_trade_policy, which re-checks is_admin (defence in depth). The SQL trade
-- guard (_trade_limit_usdt, inside order_create) and the bond gate
-- (merchant_post_bond) now read these live, so they remain the authoritative
-- enforcement — the TS mirror in src/lib/reputation.ts is display only.

-- ── policy columns on the settings singleton ─────────────────────────────────
alter table public.platform_settings
  add column if not exists min_merchant_bond numeric(20, 6) not null default 500
    check (min_merchant_bond > 0),
  add column if not exists trade_limit_new numeric(20, 6) default 100
    check (trade_limit_new is null or trade_limit_new >= 0),
  add column if not exists trade_limit_active numeric(20, 6) default 1000
    check (trade_limit_active is null or trade_limit_active >= 0),
  add column if not exists trade_limit_established numeric(20, 6) default 10000
    check (trade_limit_established is null or trade_limit_established >= 0),
  add column if not exists tier_active_trades integer not null default 1
    check (tier_active_trades >= 1),
  add column if not exists tier_established_trades integer not null default 10
    check (tier_established_trades >= 1);

-- The ESTABLISHED tier can never require fewer trades than the ACTIVE tier.
alter table public.platform_settings
  drop constraint if exists platform_settings_tier_order;
alter table public.platform_settings
  add constraint platform_settings_tier_order
    check (tier_established_trades >= tier_active_trades);

-- ── set_trade_policy: ADMIN tunes limits + bond ──────────────────────────────
-- Re-checks is_admin and validates the inputs (positive bond, sane tier order,
-- non-negative caps). NULL caps mean "unlimited" for that tier. Upserts the
-- singleton and stamps who/when.
create or replace function public.set_trade_policy(
  p_admin             uuid,
  p_min_bond          numeric,
  p_limit_new         numeric,
  p_limit_active      numeric,
  p_limit_established numeric,
  p_active_trades     integer,
  p_established_trades integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can change the trade policy';
  end if;

  if p_min_bond is null or p_min_bond <= 0 then
    raise exception 'merchant bond minimum must be positive (got %)', p_min_bond;
  end if;
  if p_active_trades is null or p_active_trades < 1 then
    raise exception 'active-tier trade count must be at least 1 (got %)', p_active_trades;
  end if;
  if p_established_trades is null or p_established_trades < p_active_trades then
    raise exception 'established-tier trade count (%) cannot be less than the active-tier count (%)',
      p_established_trades, p_active_trades;
  end if;
  if (p_limit_new is not null and p_limit_new < 0)
     or (p_limit_active is not null and p_limit_active < 0)
     or (p_limit_established is not null and p_limit_established < 0) then
    raise exception 'trade limits cannot be negative';
  end if;

  insert into public.platform_settings (
      id, min_merchant_bond, trade_limit_new, trade_limit_active,
      trade_limit_established, tier_active_trades, tier_established_trades,
      updated_by, updated_at)
    values (
      true, round(p_min_bond, 6), round(p_limit_new, 6), round(p_limit_active, 6),
      round(p_limit_established, 6), p_active_trades, p_established_trades,
      p_admin, now())
    on conflict (id) do update
      set min_merchant_bond       = excluded.min_merchant_bond,
          trade_limit_new         = excluded.trade_limit_new,
          trade_limit_active      = excluded.trade_limit_active,
          trade_limit_established = excluded.trade_limit_established,
          tier_active_trades      = excluded.tier_active_trades,
          tier_established_trades = excluded.tier_established_trades,
          updated_by              = excluded.updated_by,
          updated_at              = excluded.updated_at;
end;
$$;

revoke all on function public.set_trade_policy(uuid, numeric, numeric, numeric, numeric, integer, integer) from public;
grant execute on function public.set_trade_policy(uuid, numeric, numeric, numeric, numeric, integer, integer) to service_role;

-- ── _trade_limit_usdt: now reads the configured tiers ────────────────────────
-- Same signature as 0011 (so order_create keeps calling it unchanged). Merchants
-- stay unlimited; everyone else is capped by the admin-configured tier their
-- completed-trade count lands in. A NULL cap = unlimited for that tier. If the
-- settings row is somehow missing we FAIL SAFE to the original 100/1k/10k caps
-- rather than fail open (no limit).
create or replace function public._trade_limit_usdt(p_user uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_is_merchant boolean;
  v_completed   integer;
  v_new         numeric;
  v_active      numeric;
  v_est         numeric;
  v_active_n    integer;
  v_est_n       integer;
begin
  select is_merchant, completed_trades
    into v_is_merchant, v_completed
    from public.users where id = p_user;
  if not found then
    raise exception 'user % not found', p_user;
  end if;

  if v_is_merchant then
    return null;                       -- bonded merchant: no per-order cap
  end if;

  select trade_limit_new, trade_limit_active, trade_limit_established,
         tier_active_trades, tier_established_trades
    into v_new, v_active, v_est, v_active_n, v_est_n
    from public.platform_settings where id;
  if not found then                    -- fail safe to the original caps
    v_new := 100; v_active := 1000; v_est := 10000;
    v_active_n := 1; v_est_n := 10;
  end if;

  if v_completed >= v_est_n then
    return v_est;
  elsif v_completed >= v_active_n then
    return v_active;
  else
    return v_new;
  end if;
end;
$$;

-- ── merchant_post_bond: now reads the configured minimum ─────────────────────
-- Same body as 0011 except the merchant-promotion threshold is read from
-- platform_settings instead of a hardcoded 500 (fail safe to 500 if missing).
create or replace function public.merchant_post_bond(
  p_user   uuid,
  p_amount numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min_bond  numeric;
  v_available numeric;
  v_bond      numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'bond amount must be positive (got %)', p_amount;
  end if;

  select min_merchant_bond into v_min_bond
    from public.platform_settings where id;
  v_min_bond := coalesce(v_min_bond, 500);

  select usdt_available, usdt_bond
    into v_available, v_bond
    from public.wallets where user_id = p_user for update;
  if not found then
    raise exception 'wallet not found for user %', p_user;
  end if;
  if v_available < p_amount then
    raise exception 'insufficient available balance: have %, need %',
      v_available, p_amount;
  end if;

  update public.wallets
    set usdt_available = usdt_available - p_amount,
        usdt_bond      = usdt_bond + p_amount
    where user_id = p_user;

  insert into public.ledger_entries (user_id, type, amount_usdt)
    values (p_user, 'BOND_LOCK', p_amount);

  -- Once the bond clears the configured minimum, the user becomes a merchant.
  if v_bond + p_amount >= v_min_bond then
    update public.users set is_merchant = true where id = p_user;
  end if;
end;
$$;

-- Re-assert grants (CREATE OR REPLACE keeps them, restated for clarity).
grant execute on function public._trade_limit_usdt(uuid) to service_role;
grant execute on function public.merchant_post_bond(uuid, numeric) to service_role;
