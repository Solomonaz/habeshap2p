-- 0023 — enforce the payment window in the escrow state machine (bug fixes)
--
-- The payment window (orders.expires_at) was only ever swept by a background cron
-- (order_expire_unpaid). Nothing in the per-order transitions checked it, which
-- left two holes:
--
--   • order_release accepted an EXPIRED unpaid (CREATED) order. Because it only
--     checked state, a seller could still release after the window elapsed — and
--     in any environment where the cron isn't running (e.g. local dev) an expired
--     order stayed releasable FOREVER. This is the critical one: an overdue,
--     unpaid order must be dead — cancel-only, never releasable.
--   • order_mark_paid accepted a "paid" claim after the deadline had passed.
--
-- This migration makes expires_at authoritative on the transitions themselves
-- (the database is the real gate, not the UI), and adds a single-order expiry
-- helper the UI can fire the moment its countdown hits zero, so auto-cancel no
-- longer depends on the cron's cadence.
--
-- NOTE on PAID orders: once a buyer has marked an order PAID, expiry NO LONGER
-- applies. A paid order is never auto-cancelled (that would return the USDT to
-- the seller while the buyer may have really sent ETB) — it can only be RELEASED
-- by the seller or settled by an admin dispute. So the window only gates the
-- CREATED (unpaid) state.

-- ── order_expire_due: cancel ONE order iff it is overdue and still unpaid ─────
-- Idempotent and safe for anyone to call (the UI countdown, any party, the cron):
-- it cancels only when the order is genuinely CREATED and past its deadline,
-- otherwise it no-ops and returns false. Reuses order_cancel(..., null) so the
-- escrow-unlock + state change stay in one place.
create or replace function public.order_expire_due(p_order uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order for update;
  if not found then
    raise exception 'order % not found', p_order;
  end if;

  if v_order.state = 'CREATED' and v_order.expires_at <= now() then
    perform public.order_cancel(p_order, null);
    return true;
  end if;
  return false;
end;
$$;

revoke all on function public.order_expire_due(uuid) from public;
grant execute on function public.order_expire_due(uuid) to service_role;

-- ── order_mark_paid: refuse once the payment window has elapsed ───────────────
-- Same body as migration 0007 plus an expiry guard: you cannot claim payment
-- after the deadline. The order is overdue and headed for auto-cancel.
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
  if v_order.expires_at <= now() then
    raise exception 'order % payment window has elapsed — cannot mark paid', p_order;
  end if;

  update public.orders
    set state = 'PAID', paid_at = now()
    where id = p_order;
end;
$$;

-- ── order_release: refuse an EXPIRED unpaid (CREATED) order ───────────────────
-- Byte-for-byte the migration 0020 body (configured fee + min/max clamp) with one
-- added guard: an unpaid order whose window has elapsed can NOT be released — it
-- is cancel-only. A PAID order is unaffected by expiry and stays releasable.
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
  -- An unpaid order past its deadline is dead: it may only be cancelled, never
  -- released. (PAID orders ignore expiry — the buyer has committed.)
  if v_order.state = 'CREATED' and v_order.expires_at <= now() then
    raise exception 'order % payment window has elapsed — it can only be cancelled', p_order;
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
