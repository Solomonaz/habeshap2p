-- 0051 — cap referral rewards to a referee's first N completed trades
--
-- Instead of paying a referrer for the lifetime of a referral, only the
-- referee's first `referral_max_trades` completed trades earn a reward. The cap
-- is admin-configurable (default 10; set 0 for unlimited / lifetime).
--
-- Gate mechanism: order_release credits the referral BEFORE it bumps reputation,
-- so a participant's `completed_trades` at that point is the count of trades
-- completed BEFORE this one. Rewarding while `completed_trades < N` therefore
-- covers exactly their first N trades (the 1st is count 0, the Nth is count N-1).

set check_function_bodies = off;

alter table public.platform_settings
  add column if not exists referral_max_trades integer not null default 10
    check (referral_max_trades >= 0);

create or replace function public.set_referral_max_trades(
  p_admin uuid,
  p_n     integer
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
    raise exception 'only an admin can change the referral trade cap';
  end if;
  if p_n is null or p_n < 0 then
    raise exception 'referral trade cap must be 0 or more (got %)', p_n;
  end if;

  insert into public.platform_settings (id, referral_max_trades, updated_by, updated_at)
    values (true, p_n, p_admin, now())
    on conflict (id) do update
      set referral_max_trades = excluded.referral_max_trades,
          updated_by          = excluded.updated_by,
          updated_at          = excluded.updated_at;
end;
$$;

revoke all on function public.set_referral_max_trades(uuid, integer) from public;
grant execute on function public.set_referral_max_trades(uuid, integer) to service_role;

-- ── order_release: same as 0050, with the referral credit now gated on the
-- referee still being within their first `referral_max_trades` trades ─────────
create or replace function public.order_release(
  p_order   uuid,
  p_actor   uuid,
  p_fee_bps integer default null,
  p_fee_min numeric default null,
  p_fee_max numeric default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   public.orders%rowtype;
  v_bps     integer;
  v_min     numeric(20, 6);
  v_max     numeric(20, 6);
  v_fee     numeric(20, 6);
  v_net     numeric(20, 6);
  v_sbps    integer;
  v_sfee    numeric(20, 6);
  v_savail  numeric(20, 6);
  v_rbps    integer;
  v_rmax    integer;
  v_ruser   uuid;
  v_rtrades integer;
  v_rref    numeric(20, 6);
begin
  select * into v_order from public.orders where id = p_order for update;
  if not found then raise exception 'order % not found', p_order; end if;
  if v_order.seller_id <> p_actor then
    raise exception 'only the seller can release escrow';
  end if;
  if v_order.state not in ('CREATED', 'PAID') then
    raise exception 'order % is % — cannot release', p_order, v_order.state;
  end if;
  if v_order.state = 'CREATED' and v_order.expires_at <= now() then
    raise exception 'order % payment window has elapsed — it can only be cancelled', p_order;
  end if;

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

  v_fee := round(v_order.amount_usdt * v_bps / 10000.0, 6);
  if v_fee < v_min then v_fee := v_min; end if;
  if v_max is not null and v_fee > v_max then v_fee := v_max; end if;
  if v_fee > v_order.amount_usdt then v_fee := v_order.amount_usdt; end if;
  v_net := v_order.amount_usdt - v_fee;
  if v_net < 0 then raise exception 'fee exceeds amount'; end if;

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

  -- Referral reward parameters (rate + how many of a referee's trades qualify).
  select referral_bps, referral_max_trades into v_rbps, v_rmax
    from public.platform_settings where id;
  v_rbps := coalesce(v_rbps, 0);
  v_rmax := coalesce(v_rmax, 0);  -- 0 ⇒ unlimited (lifetime)

  -- Referral share of the BUYER fee → the buyer's referrer, only while the buyer
  -- is still within their first v_rmax completed trades (checked before the
  -- reputation bump below, so completed_trades excludes this trade).
  if v_fee > 0 and v_rbps > 0 then
    select referred_by, completed_trades into v_ruser, v_rtrades
      from public.users where id = v_order.buyer_id;
    if v_ruser is not null and v_ruser <> v_order.buyer_id
       and (v_rmax = 0 or v_rtrades < v_rmax) then
      v_rref := round(v_fee * v_rbps / 10000.0, 6);
      if v_rref > v_fee then v_rref := v_fee; end if;
      if v_rref > 0 then
        update public.platform_account set usdt_fees = usdt_fees - v_rref where id;
        perform 1 from public.wallets where user_id = v_ruser for update;
        update public.wallets set usdt_available = usdt_available + v_rref
          where user_id = v_ruser;
        insert into public.ledger_entries (user_id, order_id, type, amount_usdt)
          values (v_ruser, p_order, 'REFERRAL', v_rref);
      end if;
    end if;
  end if;

  -- Seller fee: from the seller's own available balance, capped at it.
  select seller_fee_bps into v_sbps from public.platform_settings where id;
  v_sbps := coalesce(v_sbps, 0);
  v_sfee := round(v_order.amount_usdt * v_sbps / 10000.0, 6);
  if v_sfee > 0 then
    select usdt_available into v_savail
      from public.wallets where user_id = v_order.seller_id;
    if v_savail < v_sfee then v_sfee := v_savail; end if;
    if v_sfee > 0 then
      update public.wallets
        set usdt_available = usdt_available - v_sfee
        where user_id = v_order.seller_id;
      update public.platform_account set usdt_fees = usdt_fees + v_sfee where id;
      insert into public.ledger_entries (user_id, order_id, type, amount_usdt)
        values (v_order.seller_id, p_order, 'FEE', v_sfee);

      -- Referral share of the SELLER fee → the seller's referrer, same cap.
      if v_rbps > 0 then
        select referred_by, completed_trades into v_ruser, v_rtrades
          from public.users where id = v_order.seller_id;
        if v_ruser is not null and v_ruser <> v_order.seller_id
           and (v_rmax = 0 or v_rtrades < v_rmax) then
          v_rref := round(v_sfee * v_rbps / 10000.0, 6);
          if v_rref > v_sfee then v_rref := v_sfee; end if;
          if v_rref > 0 then
            update public.platform_account set usdt_fees = usdt_fees - v_rref where id;
            perform 1 from public.wallets where user_id = v_ruser for update;
            update public.wallets set usdt_available = usdt_available + v_rref
              where user_id = v_ruser;
            insert into public.ledger_entries (user_id, order_id, type, amount_usdt)
              values (v_ruser, p_order, 'REFERRAL', v_rref);
          end if;
        end if;
      end if;
    end if;
  end if;

  update public.orders
    set state = 'RELEASED', released_at = now(),
        fee_usdt = v_fee, seller_fee_usdt = v_sfee
    where id = p_order;

  perform public._bump_reputation(v_order.seller_id, true,
    extract(epoch from (now() - v_order.created_at))::int);
  perform public._bump_reputation(v_order.buyer_id, false, null);
end;
$$;
