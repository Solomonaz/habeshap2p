-- 0012 — on-chain (Tron TRC-20 USDT) deposits + withdrawals (Phase 7)
--
-- The internal ledger is the source of truth for balances; this migration wires
-- the on/off ramps that mint into it (a confirmed deposit) and burn out of it (a
-- broadcast withdrawal). Both are driven by TRUSTED SERVER WORKERS (a deposit
-- poller and a withdrawal signer) using the service role — never the client.
--
-- Conservation note: deposits and withdrawals are the ONLY operations that
-- legitimately change the system total. Everything in between (an order, a bond,
-- a withdrawal awaiting approval) only shuffles money between buckets:
--   available + locked + bond + withdraw_locked + platform_fees
-- A deposit raises that total; a *broadcast* withdrawal lowers it. A withdrawal
-- that is merely requested or rejected does NOT change the total — the funds sit
-- in usdt_withdraw_locked (a hold) and either leave (sent) or come back (reject).
--
-- RULE #6: the hot-wallet key never lives here or in the client; signing happens
-- only in server workers from a secret store. Withdrawals at/over a threshold
-- require an admin to approve before the signer will touch them, and every
-- state change is recorded (withdrawals row + ledger_entries + chain_txs).
--
-- PG GOTCHA (same as 0011): enum values added with ALTER TYPE ... ADD VALUE
-- cannot be USED in the same transaction. Function bodies reference the new
-- ledger types as literals, so defer body validation for this migration.
set check_function_bodies = off;

-- ── new hold bucket: funds reserved for a pending/approved withdrawal ─────────
-- Held out of `available` so a user can't double-spend a balance they've already
-- queued to withdraw. Still inside the conserved set until the send burns it.
alter table public.wallets
  add column usdt_withdraw_locked numeric(20, 6) not null default 0
    check (usdt_withdraw_locked >= 0);

-- ── ledger types for the withdrawal hold lifecycle ───────────────────────────
-- WITHDRAW (already exists) is the final burn when funds leave the chain.
alter type ledger_type add value if not exists 'WITHDRAW_LOCK';   -- available -> hold
alter type ledger_type add value if not exists 'WITHDRAW_UNLOCK'; -- hold -> available (refund)

-- ── withdrawal lifecycle ─────────────────────────────────────────────────────
create type withdrawal_status as enum (
  'PENDING_APPROVAL', -- amount >= threshold: waiting on an admin (rule #6)
  'APPROVED',         -- cleared to send (auto under threshold, or by an admin)
  'SENT',             -- signer broadcast it; tx_hash recorded, funds have left
  'CONFIRMED',        -- on-chain confirmation observed (terminal, success)
  'REJECTED',         -- admin denied; held funds returned to available (terminal)
  'FAILED'            -- broadcast failed before funds left; held funds returned (terminal)
);

create table public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id),
  to_address text not null check (length(btrim(to_address)) > 0),
  amount_usdt numeric(20, 6) not null check (amount_usdt > 0),
  status withdrawal_status not null default 'PENDING_APPROVAL',
  tx_hash text,                              -- set when broadcast
  reviewed_by uuid references public.users (id),
  failure_reason text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  sent_at timestamptz,
  confirmed_at timestamptz
);
create index withdrawals_user_idx on public.withdrawals (user_id, created_at);
create index withdrawals_status_idx on public.withdrawals (status);

alter table public.withdrawals enable row level security;
grant select on public.withdrawals to authenticated;
-- No client insert/update: requesting, approving, and sending are server actions
-- through the service role (which bypasses RLS).
create policy withdrawals_select_own on public.withdrawals
  for select to authenticated
  using (user_id = auth.uid());

-- ── wallet_set_deposit_address: assign a derived address once ────────────────
-- The address is derived off-chain by the server (provider) and recorded here.
-- Idempotent: if one already exists it is returned unchanged, so re-deriving is
-- harmless and a user keeps a stable deposit address.
create or replace function public.wallet_set_deposit_address(
  p_user uuid,
  p_address text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing text;
begin
  if p_address is null or length(btrim(p_address)) = 0 then
    raise exception 'deposit address is required';
  end if;

  select deposit_address into v_existing
    from public.wallets where user_id = p_user for update;
  if not found then
    raise exception 'wallet not found for user %', p_user;
  end if;
  if v_existing is not null then
    return v_existing;       -- keep the stable address already assigned
  end if;

  update public.wallets
    set deposit_address = btrim(p_address)
    where user_id = p_user;
  return btrim(p_address);
end;
$$;

-- ── credit_deposit: a confirmed inbound transfer mints into the ledger ───────
-- Called by the deposit poller for each CONFIRMED on-chain transfer it observes.
-- Idempotent on tx_hash: the unique constraint + ON CONFLICT means re-running the
-- poller over the same transfer credits the user exactly once. Returns true iff
-- this call did the crediting (false = already processed).
create or replace function public.credit_deposit(
  p_user   uuid,
  p_tx_hash text,
  p_amount numeric
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'deposit amount must be positive (got %)', p_amount;
  end if;
  if p_tx_hash is null or length(btrim(p_tx_hash)) = 0 then
    raise exception 'tx hash is required';
  end if;

  insert into public.chain_txs (user_id, direction, tx_hash, amount_usdt, confirmed)
    values (p_user, 'IN', btrim(p_tx_hash), p_amount, true)
    on conflict (tx_hash) do nothing;
  if not found then
    return false;            -- already credited on a previous poll
  end if;

  perform public.ledger_deposit(p_user, p_amount);
  return true;
end;
$$;

-- ── withdrawal_request: hold funds and queue the withdrawal ──────────────────
-- Moves `available` -> `usdt_withdraw_locked` (a hold) so the balance is reserved
-- the moment a withdrawal is requested. Amounts at/over p_threshold land in
-- PENDING_APPROVAL (an admin must approve); smaller ones are auto-APPROVED. No
-- funds leave the system here — only the signer's mark_sent burns them.
create or replace function public.withdrawal_request(
  p_user      uuid,
  p_to_address text,
  p_amount    numeric,
  p_threshold numeric default 500
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available numeric;
  v_id        uuid;
  v_status    withdrawal_status;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'withdrawal amount must be positive (got %)', p_amount;
  end if;
  if p_to_address is null or length(btrim(p_to_address)) = 0 then
    raise exception 'destination address is required';
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
    set usdt_available      = usdt_available - p_amount,
        usdt_withdraw_locked = usdt_withdraw_locked + p_amount
    where user_id = p_user;

  insert into public.ledger_entries (user_id, type, amount_usdt)
    values (p_user, 'WITHDRAW_LOCK', p_amount);

  v_status := case when p_amount >= p_threshold
                then 'PENDING_APPROVAL'::withdrawal_status
                else 'APPROVED'::withdrawal_status end;

  insert into public.withdrawals (user_id, to_address, amount_usdt, status)
    values (p_user, btrim(p_to_address), p_amount, v_status)
    returning id into v_id;

  return v_id;
end;
$$;

-- ── withdrawal_approve: ADMIN clears a pending withdrawal to send ────────────
create or replace function public.withdrawal_approve(
  p_id    uuid,
  p_admin uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_status   withdrawal_status;
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can approve a withdrawal';
  end if;

  select status into v_status from public.withdrawals where id = p_id for update;
  if not found then raise exception 'withdrawal % not found', p_id; end if;
  if v_status <> 'PENDING_APPROVAL' then
    raise exception 'withdrawal % is % — not pending approval', p_id, v_status;
  end if;

  update public.withdrawals
    set status = 'APPROVED', reviewed_by = p_admin, reviewed_at = now()
    where id = p_id;
end;
$$;

-- ── withdrawal_reject: ADMIN denies; held funds return to available ──────────
create or replace function public.withdrawal_reject(
  p_id     uuid,
  p_admin  uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_w        public.withdrawals%rowtype;
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can reject a withdrawal';
  end if;

  select * into v_w from public.withdrawals where id = p_id for update;
  if not found then raise exception 'withdrawal % not found', p_id; end if;
  if v_w.status <> 'PENDING_APPROVAL' then
    raise exception 'withdrawal % is % — not pending approval', p_id, v_w.status;
  end if;

  -- Return the held funds to the user (no money left the system).
  perform 1 from public.wallets where user_id = v_w.user_id for update;
  update public.wallets
    set usdt_withdraw_locked = usdt_withdraw_locked - v_w.amount_usdt,
        usdt_available       = usdt_available + v_w.amount_usdt
    where user_id = v_w.user_id;

  insert into public.ledger_entries (user_id, type, amount_usdt)
    values (v_w.user_id, 'WITHDRAW_UNLOCK', v_w.amount_usdt);

  update public.withdrawals
    set status = 'REJECTED', reviewed_by = p_admin, reviewed_at = now(),
        failure_reason = btrim(coalesce(p_reason, ''))
    where id = p_id;
end;
$$;

-- ── withdrawal_mark_sent: the signer broadcast it; BURN the held funds ───────
-- Called only after the server signer has a broadcast tx hash. This is the point
-- the funds actually leave the system, so the hold is debited (not refunded) and
-- a WITHDRAW ledger line + an OUT chain_txs row are written for reconciliation.
create or replace function public.withdrawal_mark_sent(
  p_id      uuid,
  p_tx_hash text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_w public.withdrawals%rowtype;
begin
  if p_tx_hash is null or length(btrim(p_tx_hash)) = 0 then
    raise exception 'tx hash is required to mark sent';
  end if;

  select * into v_w from public.withdrawals where id = p_id for update;
  if not found then raise exception 'withdrawal % not found', p_id; end if;
  if v_w.status <> 'APPROVED' then
    raise exception 'withdrawal % is % — not approved for sending', p_id, v_w.status;
  end if;

  perform 1 from public.wallets where user_id = v_w.user_id for update;
  update public.wallets
    set usdt_withdraw_locked = usdt_withdraw_locked - v_w.amount_usdt
    where user_id = v_w.user_id;

  insert into public.ledger_entries (user_id, type, amount_usdt)
    values (v_w.user_id, 'WITHDRAW', v_w.amount_usdt);

  insert into public.chain_txs (user_id, direction, tx_hash, amount_usdt, confirmed)
    values (v_w.user_id, 'OUT', btrim(p_tx_hash), v_w.amount_usdt, false);

  update public.withdrawals
    set status = 'SENT', tx_hash = btrim(p_tx_hash), sent_at = now()
    where id = p_id;
end;
$$;

-- ── withdrawal_mark_failed: broadcast failed BEFORE funds left; refund hold ──
create or replace function public.withdrawal_mark_failed(
  p_id     uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_w public.withdrawals%rowtype;
begin
  select * into v_w from public.withdrawals where id = p_id for update;
  if not found then raise exception 'withdrawal % not found', p_id; end if;
  -- Only an APPROVED-but-not-yet-sent withdrawal can be refunded. If it already
  -- reached SENT the funds are gone and this must not double-credit.
  if v_w.status <> 'APPROVED' then
    raise exception 'withdrawal % is % — cannot mark failed', p_id, v_w.status;
  end if;

  perform 1 from public.wallets where user_id = v_w.user_id for update;
  update public.wallets
    set usdt_withdraw_locked = usdt_withdraw_locked - v_w.amount_usdt,
        usdt_available       = usdt_available + v_w.amount_usdt
    where user_id = v_w.user_id;

  insert into public.ledger_entries (user_id, type, amount_usdt)
    values (v_w.user_id, 'WITHDRAW_UNLOCK', v_w.amount_usdt);

  update public.withdrawals
    set status = 'FAILED', failure_reason = btrim(coalesce(p_reason, ''))
    where id = p_id;
end;
$$;

-- ── withdrawal_mark_confirmed: on-chain confirmation observed ────────────────
create or replace function public.withdrawal_mark_confirmed(
  p_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_w public.withdrawals%rowtype;
begin
  select * into v_w from public.withdrawals where id = p_id for update;
  if not found then raise exception 'withdrawal % not found', p_id; end if;
  if v_w.status <> 'SENT' then
    raise exception 'withdrawal % is % — not awaiting confirmation', p_id, v_w.status;
  end if;

  update public.chain_txs set confirmed = true
    where tx_hash = v_w.tx_hash and direction = 'OUT';

  update public.withdrawals
    set status = 'CONFIRMED', confirmed_at = now()
    where id = p_id;
end;
$$;

-- ── EXECUTE: server (service_role) only — never anon/authenticated ───────────
revoke all on function public.wallet_set_deposit_address(uuid, text) from public;
revoke all on function public.credit_deposit(uuid, text, numeric) from public;
revoke all on function public.withdrawal_request(uuid, text, numeric, numeric) from public;
revoke all on function public.withdrawal_approve(uuid, uuid) from public;
revoke all on function public.withdrawal_reject(uuid, uuid, text) from public;
revoke all on function public.withdrawal_mark_sent(uuid, text) from public;
revoke all on function public.withdrawal_mark_failed(uuid, text) from public;
revoke all on function public.withdrawal_mark_confirmed(uuid) from public;

grant execute on function public.wallet_set_deposit_address(uuid, text) to service_role;
grant execute on function public.credit_deposit(uuid, text, numeric) to service_role;
grant execute on function public.withdrawal_request(uuid, text, numeric, numeric) to service_role;
grant execute on function public.withdrawal_approve(uuid, uuid) to service_role;
grant execute on function public.withdrawal_reject(uuid, uuid, text) to service_role;
grant execute on function public.withdrawal_mark_sent(uuid, text) to service_role;
grant execute on function public.withdrawal_mark_failed(uuid, text) to service_role;
grant execute on function public.withdrawal_mark_confirmed(uuid) to service_role;
