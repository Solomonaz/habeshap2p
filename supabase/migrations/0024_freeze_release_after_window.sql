-- 0024 — freeze release once the payment window elapses (PAID orders too)
--
-- Migration 0023 stopped an EXPIRED *unpaid* (CREATED) order from being released.
-- But it deliberately still let a PAID order be released after the window — the
-- reasoning was that a paid order is a committed trade. The product rule is the
-- opposite: once the window elapses the seller has MISSED their chance to release
-- unilaterally. From that moment the escrow is frozen and the ONLY way it moves
-- is an admin dispute ruling (order_open_dispute → dispute_resolve), which keeps
-- the seller's USDT locked until a human decides who it belongs to.
--
-- So order_release must refuse the moment now() >= expires_at, whatever the
-- state:
--   • CREATED + elapsed → dead, cancel-only (auto-cancels).
--   • PAID    + elapsed → frozen, dispute-only (escrow stays locked).
--
-- A seller can still release normally any time BEFORE the deadline. Everything
-- else in the function (configured fee + min/max clamp, ledger trail, reputation
-- bump) is byte-for-byte the migration 0023 body.
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
  -- Past the deadline the seller can no longer release. An unpaid order is
  -- cancel-only; a paid one is frozen for dispute (escrow stays locked).
  if v_order.expires_at <= now() then
    if v_order.state = 'CREATED' then
      raise exception 'order % payment window has elapsed — it can only be cancelled', p_order;
    else
      raise exception 'order % release window has elapsed — the escrow is frozen; resolve it through a dispute', p_order;
    end if;
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
