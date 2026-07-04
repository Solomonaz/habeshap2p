-- 0049 — seller-side trade fee + internal-transfer fee (both admin-configurable)
--
-- Two new revenue levers, both defaulting to 0 so behaviour is UNCHANGED until an
-- admin turns them on:
--   • seller_fee_bps — a % the SELLER pays on a completed trade, charged from the
--     seller's own available balance at release (capped at what they hold, so it
--     never touches the escrow, the buyer's proceeds, or the cancel/freeze paths —
--     the release money-flow is otherwise identical). The buyer fee (fee_bps) is
--     unchanged.
--   • internal_transfer_fee_usdt — a flat fee on a free internal transfer,
--     deducted from the amount (recipient gets amount − fee).
-- Both accrue to platform_account.usdt_fees, like every other fee.

alter table public.platform_settings
  add column if not exists seller_fee_bps integer not null default 0
    check (seller_fee_bps >= 0 and seller_fee_bps <= 10000),
  add column if not exists internal_transfer_fee_usdt numeric(20, 6) not null default 0
    check (internal_transfer_fee_usdt >= 0);

alter table public.orders
  add column if not exists seller_fee_usdt numeric(20, 6) not null default 0;

-- ── setters ──────────────────────────────────────────────────────────────────
create or replace function public.set_seller_fee(
  p_admin uuid,
  p_bps   integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_is_admin boolean;
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can change the seller fee';
  end if;
  if p_bps is null or p_bps < 0 or p_bps > 10000 then
    raise exception 'seller fee bps must be between 0 and 10000 (got %)', p_bps;
  end if;
  insert into public.platform_settings (id, seller_fee_bps, updated_by, updated_at)
    values (true, p_bps, p_admin, now())
    on conflict (id) do update
      set seller_fee_bps = excluded.seller_fee_bps,
          updated_by     = excluded.updated_by,
          updated_at     = excluded.updated_at;
end;
$$;
revoke all on function public.set_seller_fee(uuid, integer) from public;
grant execute on function public.set_seller_fee(uuid, integer) to service_role;

create or replace function public.set_internal_transfer_fee(
  p_admin uuid,
  p_fee   numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_is_admin boolean;
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can change the transfer fee';
  end if;
  if p_fee is null or p_fee < 0 then
    raise exception 'transfer fee must be zero or positive (got %)', p_fee;
  end if;
  insert into public.platform_settings (id, internal_transfer_fee_usdt, updated_by, updated_at)
    values (true, round(p_fee, 6), p_admin, now())
    on conflict (id) do update
      set internal_transfer_fee_usdt = excluded.internal_transfer_fee_usdt,
          updated_by                 = excluded.updated_by,
          updated_at                 = excluded.updated_at;
end;
$$;
revoke all on function public.set_internal_transfer_fee(uuid, numeric) from public;
grant execute on function public.set_internal_transfer_fee(uuid, numeric) to service_role;

-- ── order_release: unchanged buyer-fee flow + a seller fee from seller balance ─
-- Byte-for-byte the migration 0023 body plus a self-contained seller-fee block
-- after the main money move: charge seller_fee_bps of the amount from the seller's
-- OWN available balance (capped), accrue it to platform fees, and record it. This
-- is a pure seller-available → platform move; it can't affect the buyer's net,
-- the escrow, or conservation of the escrow flow.
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

-- ── internal_transfer: deduct the flat transfer fee (recipient gets net) ──────
create or replace function public.internal_transfer(
  p_sender       uuid,
  p_recipient_id text,
  p_amount       numeric
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rid        text;
  v_recipient  uuid;
  v_r_status   text;
  v_s_kyc      kyc_status;
  v_s_status   text;
  v_available  numeric;
  v_fee        numeric(20, 6);
  v_net        numeric(20, 6);
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'transfer amount must be positive (got %)', p_amount;
  end if;

  select internal_transfer_fee_usdt into v_fee from public.platform_settings where id;
  v_fee := coalesce(v_fee, 0);
  v_net := p_amount - v_fee;
  if v_net <= 0 then
    raise exception 'amount must be greater than the % USDT transfer fee', v_fee;
  end if;

  v_rid := regexp_replace(btrim(coalesce(p_recipient_id, '')), '[^0-9]', '', 'g');
  if length(v_rid) = 0 then
    raise exception 'enter the recipient''s HabeshaP2P ID';
  end if;

  select id, account_status into v_recipient, v_r_status
    from public.users where public_id = v_rid;
  if not found then
    raise exception 'no account with HabeshaP2P ID %', v_rid;
  end if;
  if v_recipient = p_sender then
    raise exception 'you can''t transfer to your own account';
  end if;
  if v_r_status <> 'ACTIVE' then
    raise exception 'the recipient account is not active';
  end if;

  select kyc_status, account_status into v_s_kyc, v_s_status
    from public.users where id = p_sender;
  if v_s_status <> 'ACTIVE' then
    raise exception 'your account is not active';
  end if;
  if v_s_kyc <> 'APPROVED' then
    raise exception 'complete identity verification before sending funds';
  end if;

  select usdt_available into v_available
    from public.wallets where user_id = p_sender for update;
  if not found then
    raise exception 'sender wallet not found';
  end if;
  if v_available < p_amount then
    raise exception 'insufficient available balance: have %, need %',
      v_available, p_amount;
  end if;
  perform 1 from public.wallets where user_id = v_recipient for update;

  update public.wallets
    set usdt_available = usdt_available - p_amount
    where user_id = p_sender;
  update public.wallets
    set usdt_available = usdt_available + v_net
    where user_id = v_recipient;

  insert into public.ledger_entries (user_id, type, amount_usdt) values
    (p_sender,    'TRANSFER_OUT', p_amount),
    (v_recipient, 'TRANSFER_IN',  v_net);

  if v_fee > 0 then
    update public.platform_account set usdt_fees = usdt_fees + v_fee where id;
    insert into public.ledger_entries (user_id, type, amount_usdt)
      values (p_sender, 'FEE', v_fee);
  end if;

  return v_recipient;
end;
$$;
revoke all on function public.internal_transfer(uuid, text, numeric) from public;
grant execute on function public.internal_transfer(uuid, text, numeric) to service_role;
