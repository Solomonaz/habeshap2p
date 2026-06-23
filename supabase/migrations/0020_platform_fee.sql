-- 0020 — admin-configurable per-trade commission fee (Phase 9)
--
-- The platform earns revenue by skimming a taker fee when a SELLER releases
-- escrow on a successful P2P trade (order_release → platform_account.usdt_fees).
-- Until now that rate was HARDCODED at 25 bps (0.25%). This migration makes it
-- ADMIN-CONFIGURABLE so the system owner can set it to 0, 1%, or anything:
--
--   fee_bps       — rate in basis points (1 bps = 0.01%). 0 disables the fee.
--   fee_min_usdt  — a per-trade floor: the fee is never LESS than this (0 = none).
--   fee_max_usdt  — a per-trade cap:   the fee is never MORE than this (NULL = none).
--
-- The fee lives on the existing platform_settings singleton (id = true, 0018),
-- next to the live-payments switch. It is written ONLY through set_platform_fee,
-- which re-checks is_admin (defence in depth). Admins may READ it (the existing
-- platform_settings_select_admin policy already covers the new columns).
--
-- Dispute rulings still charge NO fee (an admin-resolved contested order is an
-- exceptional path — see 0010); only the normal order_release path applies it.

-- ── fee columns on the settings singleton ────────────────────────────────────
alter table public.platform_settings
  add column if not exists fee_bps integer not null default 25
    check (fee_bps >= 0 and fee_bps <= 10000),          -- 0%–100%
  add column if not exists fee_min_usdt numeric(20, 6) not null default 0
    check (fee_min_usdt >= 0),
  add column if not exists fee_max_usdt numeric(20, 6)
    check (fee_max_usdt is null or fee_max_usdt >= 0);

-- ── set_platform_fee: ADMIN sets the rate + min/max clamp ────────────────────
-- Re-checks is_admin (a non-admin id can never change the fee even if it somehow
-- reached here). Validates the inputs, upserts the singleton, stamps who/when,
-- and returns the bps value now in effect.
create or replace function public.set_platform_fee(
  p_admin   uuid,
  p_fee_bps integer,
  p_fee_min numeric default 0,
  p_fee_max numeric default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_min numeric(20, 6) := coalesce(p_fee_min, 0);
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can change the platform fee';
  end if;

  if p_fee_bps is null or p_fee_bps < 0 or p_fee_bps > 10000 then
    raise exception 'fee_bps must be between 0 and 10000 (got %)', p_fee_bps;
  end if;
  if v_min < 0 then
    raise exception 'minimum fee cannot be negative (got %)', v_min;
  end if;
  if p_fee_max is not null and p_fee_max < 0 then
    raise exception 'maximum fee cannot be negative (got %)', p_fee_max;
  end if;
  if p_fee_max is not null and p_fee_max < v_min then
    raise exception 'maximum fee % cannot be less than minimum fee %', p_fee_max, v_min;
  end if;

  insert into public.platform_settings
      (id, fee_bps, fee_min_usdt, fee_max_usdt, updated_by, updated_at)
    values (true, p_fee_bps, round(v_min, 6), round(p_fee_max, 6), p_admin, now())
    on conflict (id) do update
      set fee_bps      = excluded.fee_bps,
          fee_min_usdt = excluded.fee_min_usdt,
          fee_max_usdt = excluded.fee_max_usdt,
          updated_by   = excluded.updated_by,
          updated_at   = excluded.updated_at;

  return p_fee_bps;
end;
$$;

revoke all on function public.set_platform_fee(uuid, integer, numeric, numeric) from public;
grant execute on function public.set_platform_fee(uuid, integer, numeric, numeric) to service_role;

-- ── order_release: apply the CONFIGURED fee (percentage + min/max clamp) ──────
-- The old 3-arg order_release(uuid, uuid, integer) hardcoded a default of 25 bps
-- and no clamp. Replace it: when the caller passes no override (p_fee_bps null),
-- the fee is read live from platform_settings. We DROP the old signature first so
-- a 2-arg call from the app can never become ambiguous between two overloads.
drop function if exists public.order_release(uuid, uuid, integer);

create or replace function public.order_release(
  p_order   uuid,
  p_actor   uuid,
  p_fee_bps integer default null,   -- null = use the admin-configured rate
  p_fee_min numeric default null,   -- null = use the admin-configured floor
  p_fee_max numeric default null    -- null = use the admin-configured cap
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_bps   integer;
  v_min   numeric(20, 6);
  v_max   numeric(20, 6);
  v_fee   numeric(20, 6);
  v_net   numeric(20, 6);
begin
  select * into v_order from public.orders where id = p_order for update;
  if not found then raise exception 'order % not found', p_order; end if;
  if v_order.seller_id <> p_actor then
    raise exception 'only the seller can release escrow';   -- rule #1
  end if;
  if v_order.state not in ('CREATED', 'PAID') then
    raise exception 'order % is % — cannot release', p_order, v_order.state;
  end if;

  -- Resolve the fee config: an explicit override wins, otherwise read the live
  -- admin-configured fee off the platform_settings singleton.
  if p_fee_bps is null then
    select fee_bps, fee_min_usdt, fee_max_usdt
      into v_bps, v_min, v_max
      from public.platform_settings where id;
  else
    v_bps := p_fee_bps;
    v_min := p_fee_min;
    v_max := p_fee_max;
  end if;
  v_bps := coalesce(v_bps, 25);
  v_min := coalesce(v_min, 0);

  -- Fee math mirrors src/lib/money.ts: half-up rounding at micro (6dp) scale,
  -- then clamp to the configured [min, max] band, and net + fee = amount exactly.
  v_fee := round(v_order.amount_usdt * v_bps / 10000.0, 6);
  if v_fee < v_min then v_fee := v_min; end if;
  if v_max is not null and v_fee > v_max then v_fee := v_max; end if;
  -- Safety: a min larger than a tiny trade must never make the buyer's net go
  -- negative — the fee can never exceed the trade amount.
  if v_fee > v_order.amount_usdt then v_fee := v_order.amount_usdt; end if;
  v_net := v_order.amount_usdt - v_fee;
  if v_net < 0 then raise exception 'fee exceeds amount'; end if;

  -- Move funds: seller's locked escrow leaves; buyer credited net; fee accrues.
  perform 1 from public.wallets where user_id = v_order.seller_id for update;
  perform 1 from public.wallets where user_id = v_order.buyer_id  for update;

  update public.wallets
    set usdt_locked = usdt_locked - v_order.amount_usdt
    where user_id = v_order.seller_id;
  update public.wallets
    set usdt_available = usdt_available + v_net
    where user_id = v_order.buyer_id;
  update public.platform_account set usdt_fees = usdt_fees + v_fee where id;

  insert into public.ledger_entries (user_id, order_id, type, amount_usdt) values
    (v_order.seller_id, p_order, 'RELEASE', v_order.amount_usdt),
    (v_order.buyer_id,  p_order, 'RELEASE', v_net),
    (null,              p_order, 'FEE',     v_fee);

  update public.orders
    set state = 'RELEASED', released_at = now(), fee_usdt = v_fee
    where id = p_order;

  perform public._bump_reputation(v_order.seller_id, true,
    extract(epoch from (now() - v_order.created_at))::int);
  perform public._bump_reputation(v_order.buyer_id, false, null);
end;
$$;

revoke all on function public.order_release(uuid, uuid, integer, numeric, numeric) from public;
grant execute on function public.order_release(uuid, uuid, integer, numeric, numeric) to service_role;
