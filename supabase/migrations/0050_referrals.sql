-- 0050 — referral program (fee-share model)
--
-- A referrer earns a configurable share of the PLATFORM FEE that each of their
-- referrals generates on a completed trade. It is self-funding: the reward comes
-- out of the fee the platform already collected (never out of principal), and is
-- paid as an internal USDT credit (off-chain, no gas). Conservation is preserved:
-- the fee that used to go entirely to platform_account.usdt_fees is now split
-- between the platform and the referrer — the total is unchanged.
--
-- Attribution: `users.referred_by` is set ONCE at signup from an optional ?ref
-- code (the referrer's public_id / HabeshaP2P ID). No self-referral. If a user
-- has no referrer, behaviour is byte-for-byte identical to before.

-- The new order_release references the 'REFERRAL' ledger label added below; defer
-- body validation so the label needn't be visible at definition time (same
-- pattern as 0046's TRANSFER_OUT/TRANSFER_IN).
set check_function_bodies = off;

alter type ledger_type add value if not exists 'REFERRAL'; -- referrer available +

-- ── who referred each user (set once at signup) ──────────────────────────────
alter table public.users
  add column if not exists referred_by uuid references public.users(id);
create index if not exists users_referred_by_idx on public.users(referred_by);

-- ── admin-configurable referral rate ─────────────────────────────────────────
-- Share of the platform fee paid to the referrer, in basis points (2000 = 20%).
-- Default 20%: harmless for existing data (every current user has referred_by
-- NULL, so nothing is credited) and live for new referred signups.
alter table public.platform_settings
  add column if not exists referral_bps integer not null default 2000
    check (referral_bps >= 0 and referral_bps <= 10000);

create or replace function public.set_referral_bps(
  p_admin uuid,
  p_bps   integer
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
    raise exception 'only an admin can change the referral rate';
  end if;
  if p_bps is null or p_bps < 0 or p_bps > 10000 then
    raise exception 'referral rate must be between 0 and 10000 bps (got %)', p_bps;
  end if;

  insert into public.platform_settings (id, referral_bps, updated_by, updated_at)
    values (true, p_bps, p_admin, now())
    on conflict (id) do update
      set referral_bps = excluded.referral_bps,
          updated_by   = excluded.updated_by,
          updated_at   = excluded.updated_at;
end;
$$;

revoke all on function public.set_referral_bps(uuid, integer) from public;
grant execute on function public.set_referral_bps(uuid, integer) to service_role;

-- ── handle_new_user: resolve an optional ?ref code into referred_by ──────────
-- Preserves the existing behaviour exactly and additionally, when the signup
-- metadata carries a 'ref' code that matches another user's public_id, records
-- that user as the referrer.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tg_id bigint;
  v_ref   uuid;
begin
  -- Telegram id arrives as a string in user metadata; coerce defensively.
  begin
    v_tg_id := nullif(new.raw_user_meta_data ->> 'telegram_id', '')::bigint;
  exception when others then
    v_tg_id := null;
  end;

  -- Optional referral code: the referrer's public_id. Ignored if it matches no
  -- user (self-referral is impossible here — the new user's public_id isn't set
  -- yet). Best-effort: a bad code just means no referrer.
  select id into v_ref
    from public.users
    where public_id = nullif(btrim(new.raw_user_meta_data ->> 'ref'), '')
      and id <> new.id
    limit 1;

  insert into public.users (id, full_name, phone, email, telegram_id, telegram_username, referred_by)
    values (
      new.id,
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      new.phone,
      new.email,
      v_tg_id,
      nullif(new.raw_user_meta_data ->> 'telegram_username', ''),
      v_ref
    )
    on conflict (id) do nothing;

  insert into public.wallets (user_id)
    values (new.id)
    on conflict (user_id) do nothing;

  return new;
end;
$$;

-- ── order_release: split a referral share off each participant's fee ─────────
-- Identical to the 0049 definition, with two added blocks that move a share of
-- the buyer fee (and, if charged, the seller fee) from platform revenue to the
-- respective referrer. The fee amounts and all prior effects are unchanged.
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
  v_order  public.orders%rowtype;
  v_bps    integer;
  v_min    numeric(20, 6);
  v_max    numeric(20, 6);
  v_fee    numeric(20, 6);
  v_net    numeric(20, 6);
  v_sbps   integer;
  v_sfee   numeric(20, 6);
  v_savail numeric(20, 6);
  v_rbps   integer;
  v_ruser  uuid;
  v_rref   numeric(20, 6);
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

  -- Referral share of the BUYER fee → the buyer's referrer (off-chain credit).
  select referral_bps into v_rbps from public.platform_settings where id;
  v_rbps := coalesce(v_rbps, 0);
  if v_fee > 0 and v_rbps > 0 then
    select referred_by into v_ruser from public.users where id = v_order.buyer_id;
    if v_ruser is not null and v_ruser <> v_order.buyer_id then
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

      -- Referral share of the SELLER fee → the seller's referrer.
      if v_rbps > 0 then
        select referred_by into v_ruser from public.users where id = v_order.seller_id;
        if v_ruser is not null and v_ruser <> v_order.seller_id then
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
