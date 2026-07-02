-- 0045 — admin-configurable withdrawal fee
--
-- A flat USDT fee charged on each withdrawal so the user covers the on-chain gas
-- (a TRC-20 send burns ~6.5–13 TRX) instead of the platform eating it. Model:
--   amount_usdt      = the GROSS amount debited from the user (unchanged meaning)
--   fee_usdt         = the fee, stored on the row at request time
--   net (amount-fee) = what actually leaves on-chain to the user
--   fee              = accrues to platform_account.usdt_fees (revenue), same place
--                      the trade fee goes.
-- Only the SEND path splits the fee; a refund (reject / failed / reconcile-refund)
-- returns the whole gross amount, since no fee is realised until funds leave.
-- Conservation still holds: on a send the system total drops by exactly `net`
-- (withdraw_locked −amount, usdt_fees +fee ⇒ −(amount−fee)).

-- ── the fee setting ──────────────────────────────────────────────────────────
alter table public.platform_settings
  add column if not exists withdrawal_fee_usdt numeric(20, 6) not null default 1
    check (withdrawal_fee_usdt >= 0);

create or replace function public.set_withdrawal_fee(
  p_admin uuid,
  p_fee   numeric
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
    raise exception 'only an admin can change the withdrawal fee';
  end if;
  if p_fee is null or p_fee < 0 then
    raise exception 'withdrawal fee must be zero or positive (got %)', p_fee;
  end if;

  insert into public.platform_settings (id, withdrawal_fee_usdt, updated_by, updated_at)
    values (true, p_fee, p_admin, now())
    on conflict (id) do update
      set withdrawal_fee_usdt = excluded.withdrawal_fee_usdt,
          updated_by          = excluded.updated_by,
          updated_at          = excluded.updated_at;
end;
$$;

revoke all on function public.set_withdrawal_fee(uuid, numeric) from public;
grant execute on function public.set_withdrawal_fee(uuid, numeric) to service_role;

-- ── the fee column on each withdrawal ────────────────────────────────────────
alter table public.withdrawals
  add column if not exists fee_usdt numeric(20, 6) not null default 0
    check (fee_usdt >= 0);
-- Net must be positive: the fee can never meet or exceed the amount. (Existing
-- rows have fee 0 < amount, so this is safe to add.)
alter table public.withdrawals
  drop constraint if exists withdrawals_fee_lt_amount;
alter table public.withdrawals
  add constraint withdrawals_fee_lt_amount check (fee_usdt < amount_usdt);

-- ── withdrawal_request: capture + store the fee, reject dust below the fee ────
drop function if exists public.withdrawal_request(uuid, text, numeric, numeric);

create or replace function public.withdrawal_request(
  p_user       uuid,
  p_to_address text,
  p_amount     numeric,
  p_threshold  numeric default 500,
  p_fee        numeric default 0
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available numeric;
  v_id        uuid;
  v_status    withdrawal_status;
  v_fee       numeric(20, 6);
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'withdrawal amount must be positive (got %)', p_amount;
  end if;
  if p_to_address is null or length(btrim(p_to_address)) = 0 then
    raise exception 'destination address is required';
  end if;

  v_fee := coalesce(p_fee, 0);
  if v_fee < 0 then
    raise exception 'withdrawal fee cannot be negative';
  end if;
  if p_amount <= v_fee then
    raise exception 'amount must be greater than the % USDT withdrawal fee', v_fee;
  end if;

  select usdt_available into v_available
    from public.wallets where user_id = p_user for update;
  if not found then
    raise exception 'wallet not found for user %', p_user;
  end if;
  if v_available < p_amount then
    raise exception 'insufficient available balance: have %, need %',
      v_available, p_amount;
  end if;

  update public.wallets
    set usdt_available       = usdt_available - p_amount,
        usdt_withdraw_locked = usdt_withdraw_locked + p_amount
    where user_id = p_user;

  insert into public.ledger_entries (user_id, type, amount_usdt)
    values (p_user, 'WITHDRAW_LOCK', p_amount);

  v_status := case when p_amount >= p_threshold
                then 'PENDING_APPROVAL'::withdrawal_status
                else 'APPROVED'::withdrawal_status end;

  insert into public.withdrawals (user_id, to_address, amount_usdt, fee_usdt, status)
    values (p_user, btrim(p_to_address), p_amount, v_fee, v_status)
    returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.withdrawal_request(uuid, text, numeric, numeric, numeric) from public;
grant execute on function public.withdrawal_request(uuid, text, numeric, numeric, numeric) to service_role;

-- ── withdrawal_mark_sent: split net (leaves) from fee (platform revenue) ──────
create or replace function public.withdrawal_mark_sent(
  p_id      uuid,
  p_tx_hash text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_w   public.withdrawals%rowtype;
  v_fee numeric(20, 6);
  v_net numeric(20, 6);
begin
  if p_tx_hash is null or length(btrim(p_tx_hash)) = 0 then
    raise exception 'tx hash is required to mark sent';
  end if;

  select * into v_w from public.withdrawals where id = p_id for update;
  if not found then raise exception 'withdrawal % not found', p_id; end if;
  if v_w.status <> 'SENDING' then
    raise exception 'withdrawal % is % — not claimed for sending', p_id, v_w.status;
  end if;

  v_fee := coalesce(v_w.fee_usdt, 0);
  v_net := v_w.amount_usdt - v_fee;

  -- Release the whole hold; the net leaves the system, the fee stays as revenue.
  perform 1 from public.wallets where user_id = v_w.user_id for update;
  update public.wallets
    set usdt_withdraw_locked = usdt_withdraw_locked - v_w.amount_usdt
    where user_id = v_w.user_id;

  insert into public.ledger_entries (user_id, type, amount_usdt)
    values (v_w.user_id, 'WITHDRAW', v_net);

  if v_fee > 0 then
    update public.platform_account set usdt_fees = usdt_fees + v_fee where id;
    insert into public.ledger_entries (user_id, type, amount_usdt)
      values (null, 'FEE', v_fee);
  end if;

  -- Record what actually left on-chain (the net).
  insert into public.chain_txs (user_id, direction, tx_hash, amount_usdt, confirmed)
    values (v_w.user_id, 'OUT', btrim(p_tx_hash), v_net, false);

  update public.withdrawals
    set status = 'SENT', tx_hash = btrim(p_tx_hash), sent_at = now()
    where id = p_id;
end;
$$;

-- ── withdrawal_reconcile_sent: same split for the admin manual path ───────────
create or replace function public.withdrawal_reconcile_sent(
  p_id      uuid,
  p_admin   uuid,
  p_tx_hash text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_w        public.withdrawals%rowtype;
  v_fee      numeric(20, 6);
  v_net      numeric(20, 6);
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can reconcile a withdrawal';
  end if;
  if p_tx_hash is null or length(btrim(p_tx_hash)) = 0 then
    raise exception 'the on-chain tx hash is required to mark a withdrawal sent';
  end if;

  select * into v_w from public.withdrawals where id = p_id for update;
  if not found then raise exception 'withdrawal % not found', p_id; end if;
  if v_w.status <> 'SENDING' then
    raise exception 'withdrawal % is % — only a stuck (SENDING) withdrawal can be reconciled', p_id, v_w.status;
  end if;

  v_fee := coalesce(v_w.fee_usdt, 0);
  v_net := v_w.amount_usdt - v_fee;

  perform 1 from public.wallets where user_id = v_w.user_id for update;
  update public.wallets
    set usdt_withdraw_locked = usdt_withdraw_locked - v_w.amount_usdt
    where user_id = v_w.user_id;

  insert into public.ledger_entries (user_id, type, amount_usdt)
    values (v_w.user_id, 'WITHDRAW', v_net);

  if v_fee > 0 then
    update public.platform_account set usdt_fees = usdt_fees + v_fee where id;
    insert into public.ledger_entries (user_id, type, amount_usdt)
      values (null, 'FEE', v_fee);
  end if;

  insert into public.chain_txs (user_id, direction, tx_hash, amount_usdt, confirmed)
    values (v_w.user_id, 'OUT', btrim(p_tx_hash), v_net, false);

  update public.withdrawals
    set status = 'SENT', tx_hash = btrim(p_tx_hash), sent_at = now()
    where id = p_id;
end;
$$;
