-- 0010 — dispute open + admin resolution (Phase 5)
--
-- Closes the loop the state machine left open in Phase 3:
--   PAID     -> DISPUTED   (either party escalates a paid-but-unreleased order)
--   DISPUTED -> RELEASED   (admin rules FOR THE BUYER: escrow -> buyer)
--   DISPUTED -> CANCELLED  (admin rules FOR THE SELLER: escrow -> seller)
--
-- Like every other transition, the money moves and the state change happen
-- inside ONE transactional, SECURITY DEFINER function with FOR UPDATE row locks,
-- executable by service_role only. Clients never write orders/disputes/wallets.
--
-- RULE #1 still holds: USDT only ever reaches the buyer via the seller's own
-- release (Phase 3) OR an admin dispute ruling here. There is no auto-release on
-- a buyer's word — a contested order freezes until a human admin decides.

-- ── order_open_dispute: a party escalates a PAID order ───────────────────────
-- A dispute is only meaningful once the buyer has claimed payment (PAID): before
-- that, an unpaid order is simply cancellable (and the timer auto-cancels it).
-- The escrow is ALREADY locked, so opening a dispute moves no money — it just
-- freezes the order so the timer/seller can no longer act on it unilaterally.
create or replace function public.order_open_dispute(
  p_order  uuid,
  p_actor  uuid,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   public.orders%rowtype;
  v_dispute uuid;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a dispute reason is required';
  end if;

  select * into v_order from public.orders where id = p_order for update;
  if not found then raise exception 'order % not found', p_order; end if;

  if p_actor <> v_order.buyer_id and p_actor <> v_order.seller_id then
    raise exception 'only a party to the order can open a dispute';
  end if;
  if v_order.state <> 'PAID' then
    raise exception 'order % is % — only a PAID order can be disputed', p_order, v_order.state;
  end if;

  -- One dispute per order (unique constraint). The order flips to DISPUTED so no
  -- release/cancel/expire path will touch it until an admin resolves.
  insert into public.disputes (order_id, opened_by, reason)
    values (p_order, p_actor, btrim(p_reason))
    returning id into v_dispute;

  update public.orders set state = 'DISPUTED' where id = p_order;

  return v_dispute;
end;
$$;

-- ── dispute_resolve: ADMIN-ONLY ruling that unfreezes the escrow ─────────────
-- p_admin is the authenticated user; we re-check is_admin HERE (defence in depth)
-- even though only service_role can call this and the route already guards it.
--   FAVOUR_BUYER  -> release escrow to the buyer, order RELEASED
--   FAVOUR_SELLER -> return escrow to the seller, order CANCELLED
--
-- NOTE: a dispute ruling charges NO taker fee. The 0.25% fee is a fee on a
-- *successful* trade; a contested order resolved by an admin is an exceptional
-- path, so the full locked amount goes to whoever the admin rules for. This
-- keeps the wallet system conserved either way and is flagged in the README.
create or replace function public.dispute_resolve(
  p_dispute    uuid,
  p_admin      uuid,
  p_resolution dispute_resolution
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispute public.disputes%rowtype;
  v_order   public.orders%rowtype;
  v_is_admin boolean;
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can resolve a dispute';
  end if;

  -- Lock the dispute, then the order it points at (consistent lock order).
  select * into v_dispute from public.disputes where id = p_dispute for update;
  if not found then raise exception 'dispute % not found', p_dispute; end if;
  if v_dispute.status = 'RESOLVED' then
    raise exception 'dispute % is already resolved', p_dispute;
  end if;

  select * into v_order from public.orders where id = v_dispute.order_id for update;
  if not found then raise exception 'order % not found', v_dispute.order_id; end if;
  if v_order.state <> 'DISPUTED' then
    raise exception 'order % is % — not in dispute', v_order.id, v_order.state;
  end if;

  if p_resolution = 'FAVOUR_BUYER' then
    -- Escrow leaves the seller's locked balance and the buyer is credited the
    -- FULL amount (no fee). Mirrors order_release's locking + ledger trail.
    perform 1 from public.wallets where user_id = v_order.seller_id for update;
    perform 1 from public.wallets where user_id = v_order.buyer_id  for update;

    update public.wallets
      set usdt_locked = usdt_locked - v_order.amount_usdt
      where user_id = v_order.seller_id;
    update public.wallets
      set usdt_available = usdt_available + v_order.amount_usdt
      where user_id = v_order.buyer_id;

    insert into public.ledger_entries (user_id, order_id, type, amount_usdt) values
      (v_order.seller_id, v_order.id, 'RELEASE', v_order.amount_usdt),
      (v_order.buyer_id,  v_order.id, 'RELEASE', v_order.amount_usdt);

    update public.orders
      set state = 'RELEASED', released_at = now()
      where id = v_order.id;

  elsif p_resolution = 'FAVOUR_SELLER' then
    -- Refund: the locked escrow returns to the seller (available), order voided.
    perform public.ledger_unlock(v_order.seller_id, v_order.amount_usdt, v_order.id);

    update public.orders
      set state = 'CANCELLED', cancelled_at = now()
      where id = v_order.id;

  else
    raise exception 'unknown resolution %', p_resolution;
  end if;

  -- Disputed trades are exceptional and deliberately do NOT bump reputation /
  -- completion stats for either party (flagged in README): a contested outcome
  -- should not reward either side.

  update public.disputes set
    status      = 'RESOLVED',
    resolution  = p_resolution,
    resolved_by = p_admin,
    resolved_at = now()
    where id = p_dispute;
end;
$$;

-- ── EXECUTE: server (service_role) only ──────────────────────────────────────
revoke all on function public.order_open_dispute(uuid, uuid, text) from public;
revoke all on function public.dispute_resolve(uuid, uuid, dispute_resolution) from public;

grant execute on function public.order_open_dispute(uuid, uuid, text) to service_role;
grant execute on function public.dispute_resolve(uuid, uuid, dispute_resolution) to service_role;
