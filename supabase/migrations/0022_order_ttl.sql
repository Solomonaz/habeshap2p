-- 0022 — admin-configurable order payment window (Phase 9)
--
-- Until now the unpaid-order deadline (the "15 minute window" the buyer has to
-- pay before the order auto-cancels) was a HARDCODED default on order_create:
--   p_ttl_minutes integer default 15
-- This migration lifts that knob onto the platform_settings singleton so an
-- admin can widen or tighten the payment window from the console — without a
-- code deploy.
--
--   order_ttl_minutes — minutes a CREATED order may sit unpaid before it is
--                       eligible for auto-cancel (order_expire_unpaid sweep).
--
-- The value is written ONLY through set_order_ttl, which re-checks is_admin
-- (defence in depth). order_create now reads it live when the caller doesn't
-- pass an explicit TTL: p_ttl_minutes defaults to NULL and, when null, the
-- function pulls order_ttl_minutes from settings (fail safe to 15 if the row is
-- somehow missing). An explicit p_ttl_minutes still wins, so callers that need a
-- specific window (tests, special flows) keep working unchanged.

-- ── the payment-window column on the settings singleton ──────────────────────
alter table public.platform_settings
  add column if not exists order_ttl_minutes integer not null default 15
    check (order_ttl_minutes >= 1);

-- ── set_order_ttl: ADMIN tunes the payment window ────────────────────────────
-- Re-checks is_admin and validates the input (at least 1 minute). Upserts the
-- singleton and stamps who/when.
create or replace function public.set_order_ttl(
  p_admin   uuid,
  p_minutes integer
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
    raise exception 'only an admin can change the order payment window';
  end if;

  if p_minutes is null or p_minutes < 1 then
    raise exception 'order payment window must be at least 1 minute (got %)', p_minutes;
  end if;

  insert into public.platform_settings (id, order_ttl_minutes, updated_by, updated_at)
    values (true, p_minutes, p_admin, now())
    on conflict (id) do update
      set order_ttl_minutes = excluded.order_ttl_minutes,
          updated_by        = excluded.updated_by,
          updated_at        = excluded.updated_at;
end;
$$;

revoke all on function public.set_order_ttl(uuid, integer) from public;
grant execute on function public.set_order_ttl(uuid, integer) to service_role;

-- ── order_create: now reads the configured window when none is passed ────────
-- Identical to migration 0011 except p_ttl_minutes now defaults to NULL and,
-- when null, the deadline is computed from the admin-configured
-- order_ttl_minutes (fail safe to 15 if the settings row is missing). An
-- explicit p_ttl_minutes still overrides. Everything else is byte-for-byte the
-- same — same trade-limit guard, same parties resolution, same escrow lock.
create or replace function public.order_create(
  p_ad uuid,
  p_taker uuid,
  p_amount_usdt numeric,
  p_payment_method payment_method,
  p_buyer_payment_name text,
  p_ttl_minutes integer default null
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
  v_ttl          integer;
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

  -- Resolve the payment window: an explicit p_ttl_minutes wins; otherwise read
  -- the admin-configured order_ttl_minutes (fail safe to 15 if no row).
  if p_ttl_minutes is not null then
    v_ttl := p_ttl_minutes;
  else
    select order_ttl_minutes into v_ttl from public.platform_settings where id;
    v_ttl := coalesce(v_ttl, 15);
  end if;

  -- Insert the order first so the lock's ledger entry carries the order id.
  insert into public.orders (
    ad_id, buyer_id, seller_id, amount_usdt, rate_etb, amount_etb,
    payment_method, buyer_payment_name, expires_at
  ) values (
    p_ad, v_buyer, v_seller, p_amount_usdt, v_ad.rate_etb, v_amount_etb,
    p_payment_method, btrim(v_payer_name),
    now() + make_interval(mins => greatest(v_ttl, 1))
  )
  returning id into v_order;

  -- Lock the seller's escrow (available -> locked) against the new order.
  perform public.ledger_lock(v_seller, p_amount_usdt, v_order);

  return v_order;
end;
$$;

-- order_create's grant from migration 0007 carries over (CREATE OR REPLACE keeps
-- existing privileges); re-assert for clarity.
grant execute on function public.order_create(uuid, uuid, numeric, payment_method, text, integer) to service_role;
