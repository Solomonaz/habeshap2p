-- 0007 — escrow orchestration (Phase 3)
--
-- The order lifecycle and every balance move it triggers run inside ONE
-- transactional, SECURITY DEFINER function per transition, with FOR UPDATE row
-- locks. Clients never write to orders/wallets directly (RLS forbids it); the
-- server calls these as service_role after authenticating the actor.
--
-- State machine (enforced here, never by the client):
--   CREATED  -> PAID       (buyer says "I sent ETB"; NO money moves)
--   CREATED  -> CANCELLED  (buyer/seller cancels while unpaid, or timer expiry)
--   PAID     -> RELEASED   (SELLER explicitly confirms receipt — rule #1)
--   CREATED  -> RELEASED   (seller may also confirm directly)
--   (DISPUTED transitions arrive with the dispute admin flow in Phase 5)
--
-- RULE #1 (non-negotiable): USDT is NEVER auto-released on a buyer claim. Only
-- the seller (order_release, actor = seller) or, later, an admin dispute ruling
-- moves escrow to the buyer. order_mark_paid does NOT touch balances.

-- ── platform fee account ─────────────────────────────────────────────────────
-- Taker fees skimmed on release accrue here. A singleton row (id = true) keeps
-- the running balance so the whole wallet system stays conserved:
--   sum(wallets.available + wallets.locked) + platform_account.usdt_fees
-- is invariant across a release. Cash-out accounting is Phase 8.
create table public.platform_account (
  id boolean primary key default true check (id),
  usdt_fees numeric(20, 6) not null default 0 check (usdt_fees >= 0)
);
insert into public.platform_account (id) values (true);

-- RLS: no client access at all. Only service_role (which bypasses RLS) reads it.
alter table public.platform_account enable row level security;

-- The FEE ledger line is platform revenue, not a user's row, so allow a null
-- owner for it. RLS (user_id = auth.uid()) then naturally hides it from users.
alter table public.ledger_entries alter column user_id drop not null;

-- ── ads.payer_name (real-name matching for BUY-side ads) ─────────────────────
-- Rule #2: the order stores the name the BUYER pays from. For a SELL ad the
-- taker IS the buyer and supplies it at order time. For a BUY ad the advertiser
-- IS the buyer, so we capture their payment-account name at post time and copy
-- it onto the order when a seller takes it.
alter table public.ads add column payer_name text;
alter table public.ads add constraint ads_buy_requires_payer_name
  check (side <> 'BUY' or (payer_name is not null and length(btrim(payer_name)) > 0));

-- ── order_create: open an order and lock the seller's USDT ───────────────────
-- p_taker is the authenticated user taking the ad (trusted from the session,
-- never from client form input). Returns the new order id.
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
  -- Insufficient balance raises here and rolls back the whole transaction,
  -- including the order row above — so a half-open order can never exist.
  perform public.ledger_lock(v_seller, p_amount_usdt, v_order);

  return v_order;
end;
$$;

-- ── order_mark_paid: buyer signals ETB sent. NO balance change (rule #1). ─────
create or replace function public.order_mark_paid(
  p_order uuid,
  p_actor uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order for update;
  if not found then raise exception 'order % not found', p_order; end if;
  if v_order.buyer_id <> p_actor then
    raise exception 'only the buyer can mark an order paid';
  end if;
  if v_order.state <> 'CREATED' then
    raise exception 'order % is % — cannot mark paid', p_order, v_order.state;
  end if;

  update public.orders
    set state = 'PAID', paid_at = now()
    where id = p_order;
end;
$$;

-- ── order_release: SELLER confirms receipt; escrow -> buyer, fee -> platform ──
create or replace function public.order_release(
  p_order uuid,
  p_actor uuid,
  p_fee_bps integer default 25
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
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

  -- Fee math mirrors src/lib/money.ts: half-up rounding at micro (6dp) scale,
  -- and net + fee = amount exactly (no dust).
  v_fee := round(v_order.amount_usdt * p_fee_bps / 10000.0, 6);
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

-- ── order_cancel: unpaid order voided; escrow returns to the seller ──────────
-- p_actor null = system/cron (expiry). Otherwise must be the buyer or seller.
create or replace function public.order_cancel(
  p_order uuid,
  p_actor uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order for update;
  if not found then raise exception 'order % not found', p_order; end if;
  if p_actor is not null
     and p_actor <> v_order.buyer_id and p_actor <> v_order.seller_id then
    raise exception 'only a party to the order can cancel it';
  end if;
  -- Once PAID, cancellation is no longer unilateral — it must go through dispute.
  if v_order.state <> 'CREATED' then
    raise exception 'order % is % — cannot cancel', p_order, v_order.state;
  end if;

  perform public.ledger_unlock(v_order.seller_id, v_order.amount_usdt, p_order);

  update public.orders
    set state = 'CANCELLED', cancelled_at = now()
    where id = p_order;
end;
$$;

-- ── order_expire_unpaid: cron sweep — cancel every overdue CREATED order ─────
create or replace function public.order_expire_unpaid()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_count integer := 0;
begin
  for v_id in
    select id from public.orders
    where state = 'CREATED' and expires_at <= now()
    order by expires_at
    for update skip locked
  loop
    perform public.order_cancel(v_id, null);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ── reputation bump (minimal; Phase 6 refines scoring/limits/merchant bond) ──
create or replace function public._bump_reputation(
  p_user uuid,
  p_is_seller boolean,
  p_release_seconds integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completed integer;
  v_terminal  integer;
begin
  select
    count(*) filter (where state = 'RELEASED'),
    count(*) filter (where state in ('RELEASED', 'CANCELLED'))
    into v_completed, v_terminal
    from public.orders
    where buyer_id = p_user or seller_id = p_user;

  update public.users set
    completed_trades = v_completed,
    completion_rate  = case when v_terminal > 0
                         then round(100.0 * v_completed / v_terminal, 2)
                         else 0 end,
    reputation_score = v_completed,
    avg_release_seconds = case
      when p_is_seller and p_release_seconds is not null and v_completed > 0
      then ((avg_release_seconds * greatest(v_completed - 1, 0)) + p_release_seconds)
           / v_completed
      else avg_release_seconds end
    where id = p_user;
end;
$$;

-- ── EXECUTE: server (service_role) only — never anon/authenticated ───────────
revoke all on function public.order_create(uuid, uuid, numeric, payment_method, text, integer) from public;
revoke all on function public.order_mark_paid(uuid, uuid) from public;
revoke all on function public.order_release(uuid, uuid, integer) from public;
revoke all on function public.order_cancel(uuid, uuid) from public;
revoke all on function public.order_expire_unpaid() from public;
revoke all on function public._bump_reputation(uuid, boolean, integer) from public;

grant execute on function public.order_create(uuid, uuid, numeric, payment_method, text, integer) to service_role;
grant execute on function public.order_mark_paid(uuid, uuid) to service_role;
grant execute on function public.order_release(uuid, uuid, integer) to service_role;
grant execute on function public.order_cancel(uuid, uuid) to service_role;
grant execute on function public.order_expire_unpaid() to service_role;
-- _bump_reputation is an internal helper, only called by the functions above
-- (which run as definer); no role needs direct EXECUTE.
