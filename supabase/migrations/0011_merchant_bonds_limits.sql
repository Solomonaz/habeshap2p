-- 0011 — merchant collateral bond + new-user trade limits (Phase 6)
--
-- Closes the two reputation/safety gaps the spec calls rule #5:
--   1. NEW-USER TRADE LIMITS — a fresh account can only open small orders. The
--      per-order cap grows as the user completes real trades, and merchants
--      (who have posted a collateral bond) are uncapped.
--   2. MERCHANT COLLATERAL BOND — a user locks USDT as a bond to become a
--      merchant. The bond is real escrowed value (skin in the game) that can be
--      slashed/withheld; here it gates merchant standing and the uncapped limit.
--
-- Like every other money move, posting/releasing a bond runs inside a single
-- transactional, SECURITY DEFINER function with a FOR UPDATE row lock, callable
-- by service_role only. The bond is held in a new wallets.usdt_bond bucket, so
-- the conservation invariant simply extends to:
--   sum(available + locked + bond) + platform_account.usdt_fees  is invariant.
--
-- PG GOTCHA: a value added to an enum with ALTER TYPE ... ADD VALUE cannot be
-- *used* in the same transaction. Migrations run in one transaction and the new
-- functions reference 'BOND_LOCK'/'BOND_RELEASE' literals in their bodies, so we
-- turn off body validation for this migration. The literals are only evaluated
-- at call time (never during the migration), so this is safe.
set check_function_bodies = off;

-- ── new escrow bucket: the collateral bond ───────────────────────────────────
alter table public.wallets
  add column usdt_bond numeric(20, 6) not null default 0 check (usdt_bond >= 0);

-- ── new ledger types for the bond lifecycle ──────────────────────────────────
alter type ledger_type add value if not exists 'BOND_LOCK';
alter type ledger_type add value if not exists 'BOND_RELEASE';

-- ── _trade_limit_usdt: the per-order cap for a user (null = unlimited) ────────
-- Mirrors src/lib/reputation.ts (tradeLimitUsdt) — keep the two in sync.
--   merchant (bonded)        -> unlimited (null)
--   >= 10 completed trades   -> 10,000 USDT
--   >=  1 completed trade    ->  1,000 USDT
--   brand-new (0 trades)     ->    100 USDT
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
begin
  select is_merchant, completed_trades
    into v_is_merchant, v_completed
    from public.users where id = p_user;
  if not found then
    raise exception 'user % not found', p_user;
  end if;

  if v_is_merchant then
    return null;                       -- bonded merchant: no per-order cap
  elsif v_completed >= 10 then
    return 10000;
  elsif v_completed >= 1 then
    return 1000;
  else
    return 100;                        -- brand-new account
  end if;
end;
$$;

-- ── merchant_post_bond: lock available USDT as collateral ────────────────────
-- Promotes the user to merchant once their total bond meets the minimum. The
-- bond is moved available -> bond (no value created), with a BOND_LOCK entry.
create or replace function public.merchant_post_bond(
  p_user   uuid,
  p_amount numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c_min_bond  constant numeric := 500;   -- minimum bond to hold merchant status
  v_available numeric;
  v_bond      numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'bond amount must be positive (got %)', p_amount;
  end if;

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

  -- Once the bond clears the minimum, the user becomes a merchant (uncapped).
  if v_bond + p_amount >= c_min_bond then
    update public.users set is_merchant = true where id = p_user;
  end if;
end;
$$;

-- ── merchant_release_bond: return the whole bond, drop merchant status ────────
-- Refuses while the user has any live order, since merchant standing/limits are
-- in play until those settle. Moves the full bond bond -> available.
create or replace function public.merchant_release_bond(
  p_user uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bond numeric;
  v_open integer;
begin
  select usdt_bond into v_bond
    from public.wallets where user_id = p_user for update;
  if not found then
    raise exception 'wallet not found for user %', p_user;
  end if;
  if v_bond <= 0 then
    raise exception 'no bond to release';
  end if;

  select count(*) into v_open
    from public.orders
    where state in ('CREATED', 'PAID', 'DISPUTED')
      and (buyer_id = p_user or seller_id = p_user);
  if v_open > 0 then
    raise exception 'cannot release bond while you have % open order(s)', v_open;
  end if;

  update public.wallets
    set usdt_bond      = 0,
        usdt_available = usdt_available + v_bond
    where user_id = p_user;

  insert into public.ledger_entries (user_id, type, amount_usdt)
    values (p_user, 'BOND_RELEASE', v_bond);

  update public.users set is_merchant = false where id = p_user;
end;
$$;

-- ── order_create: re-created with per-order trade-limit enforcement ───────────
-- Identical to migration 0007 except for the trade-limit guard added after the
-- parties are resolved: BOTH the buyer and the seller must be within their cap
-- (a new buyer can't buy big, a new seller can't sell big). Merchants (null cap)
-- are unrestricted.
create or replace function public.order_create(
  p_ad uuid,
  p_taker uuid,
  p_amount_usdt numeric,
  p_payment_method payment_method,
  p_buyer_payment_name text,
  p_ttl_minutes integer default 15
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ad           public.ads%rowtype;
  v_buyer        uuid;
  v_seller       uuid;
  v_amount_etb   numeric(20, 2);
  v_payer_name   text;
  v_order        uuid;
  v_buyer_cap    numeric;
  v_seller_cap   numeric;
begin
  if p_amount_usdt is null or p_amount_usdt <= 0 then
    raise exception 'order amount must be positive (got %)', p_amount_usdt;
  end if;

  select * into v_ad from public.ads where id = p_ad for update;
  if not found then
    raise exception 'ad % not found', p_ad;
  end if;
  if v_ad.status <> 'ACTIVE' then
    raise exception 'ad % is not active', p_ad;
  end if;
  if v_ad.user_id = p_taker then
    raise exception 'cannot take your own ad';
  end if;
  if not (p_payment_method = any (v_ad.payment_methods)) then
    raise exception 'payment method % not offered on this ad', p_payment_method;
  end if;

  -- Parties depend on which side the advertiser is on.
  if v_ad.side = 'SELL' then          -- advertiser sells USDT -> taker buys
    v_seller := v_ad.user_id;
    v_buyer  := p_taker;
    v_payer_name := p_buyer_payment_name;     -- taker (buyer) supplies it
  else                                 -- BUY ad: advertiser buys -> taker sells
    v_seller := p_taker;
    v_buyer  := v_ad.user_id;
    v_payer_name := v_ad.payer_name;          -- advertiser (buyer) supplied it
  end if;

  if v_payer_name is null or length(btrim(v_payer_name)) = 0 then
    raise exception 'buyer payment name is required';
  end if;

  -- Trade-limit guard (rule #5). Both parties must be within their per-order cap;
  -- a null cap means a bonded merchant with no limit.
  v_buyer_cap  := public._trade_limit_usdt(v_buyer);
  v_seller_cap := public._trade_limit_usdt(v_seller);
  if v_buyer_cap is not null and p_amount_usdt > v_buyer_cap then
    raise exception 'order amount % USDT exceeds the buyer trade limit of % USDT (post a merchant bond to lift it)',
      p_amount_usdt, v_buyer_cap;
  end if;
  if v_seller_cap is not null and p_amount_usdt > v_seller_cap then
    raise exception 'order amount % USDT exceeds the seller trade limit of % USDT (post a merchant bond to lift it)',
      p_amount_usdt, v_seller_cap;
  end if;

  v_amount_etb := round(p_amount_usdt * v_ad.rate_etb, 2);
  if v_amount_etb < v_ad.min_etb or v_amount_etb > v_ad.max_etb then
    raise exception 'order value % ETB is outside ad limits %–% ETB',
      v_amount_etb, v_ad.min_etb, v_ad.max_etb;
  end if;

  -- Insert the order first so the lock's ledger entry carries the order id.
  insert into public.orders (
    ad_id, buyer_id, seller_id, amount_usdt, rate_etb, amount_etb,
    payment_method, buyer_payment_name, expires_at
  ) values (
    p_ad, v_buyer, v_seller, p_amount_usdt, v_ad.rate_etb, v_amount_etb,
    p_payment_method, btrim(v_payer_name),
    now() + make_interval(mins => greatest(p_ttl_minutes, 1))
  )
  returning id into v_order;

  -- Lock the seller's escrow (available -> locked) against the new order.
  perform public.ledger_lock(v_seller, p_amount_usdt, v_order);

  return v_order;
end;
$$;

-- ── EXECUTE: server (service_role) only — never anon/authenticated ───────────
revoke all on function public._trade_limit_usdt(uuid) from public;
revoke all on function public.merchant_post_bond(uuid, numeric) from public;
revoke all on function public.merchant_release_bond(uuid) from public;

grant execute on function public._trade_limit_usdt(uuid) to service_role;
grant execute on function public.merchant_post_bond(uuid, numeric) to service_role;
grant execute on function public.merchant_release_bond(uuid) to service_role;
-- order_create's grant from migration 0007 carries over (CREATE OR REPLACE keeps
-- existing privileges); re-assert for clarity.
grant execute on function public.order_create(uuid, uuid, numeric, payment_method, text, integer) to service_role;
