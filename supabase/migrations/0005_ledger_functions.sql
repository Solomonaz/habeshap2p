-- 0005 — internal ledger primitives
--
-- These are the ONLY way balances ever change. Each function:
--   * is atomic (runs in the caller's transaction; a failed guard rolls back)
--   * takes a row lock (SELECT ... FOR UPDATE) to serialise concurrent moves on
--     the same wallet, so two orders can't double-spend the same funds
--   * enforces non-negative balances (belt-and-suspenders with the table CHECKs)
--   * writes a matching ledger_entries row so wallets and the ledger reconcile
--
-- SECURITY: these can mint and move money. They are SECURITY DEFINER and EXECUTE
-- is granted to `service_role` ONLY — never to anon/authenticated. They are
-- called exclusively from trusted server code using the service-role key. If a
-- client could call ledger_deposit, it could credit itself unlimited USDT.
--
-- The escrow ORCHESTRATION (order state transitions that call lock/unlock/
-- release, plus the fee-account wiring for release) lands in Phase 3 / Phase 8.

-- ── DEPOSIT: credit available balance (called after an on-chain deposit) ──────
create or replace function public.ledger_deposit(
  p_user uuid,
  p_amount numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'deposit amount must be positive (got %)', p_amount;
  end if;

  perform 1 from public.wallets where user_id = p_user for update;
  if not found then
    raise exception 'wallet not found for user %', p_user;
  end if;

  update public.wallets
    set usdt_available = usdt_available + p_amount
    where user_id = p_user;

  insert into public.ledger_entries (user_id, type, amount_usdt)
    values (p_user, 'DEPOSIT', p_amount);
end;
$$;

-- ── LOCK: move available -> locked (escrow hold on order CREATED) ─────────────
create or replace function public.ledger_lock(
  p_user uuid,
  p_amount numeric,
  p_order uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'lock amount must be positive (got %)', p_amount;
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
    set usdt_available = usdt_available - p_amount,
        usdt_locked    = usdt_locked + p_amount
    where user_id = p_user;

  insert into public.ledger_entries (user_id, order_id, type, amount_usdt)
    values (p_user, p_order, 'LOCK', p_amount);
end;
$$;

-- ── UNLOCK: move locked -> available (cancel / timer expiry returns funds) ────
create or replace function public.ledger_unlock(
  p_user uuid,
  p_amount numeric,
  p_order uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'unlock amount must be positive (got %)', p_amount;
  end if;

  select usdt_locked into v_locked
    from public.wallets where user_id = p_user for update;
  if not found then
    raise exception 'wallet not found for user %', p_user;
  end if;
  if v_locked < p_amount then
    raise exception 'insufficient locked balance: have %, need %',
      v_locked, p_amount;
  end if;

  update public.wallets
    set usdt_locked    = usdt_locked - p_amount,
        usdt_available = usdt_available + p_amount
    where user_id = p_user;

  insert into public.ledger_entries (user_id, order_id, type, amount_usdt)
    values (p_user, p_order, 'UNLOCK', p_amount);
end;
$$;

-- ── WITHDRAW: debit available balance (called when an on-chain send is sent) ──
create or replace function public.ledger_withdraw(
  p_user uuid,
  p_amount numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'withdraw amount must be positive (got %)', p_amount;
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
    set usdt_available = usdt_available - p_amount
    where user_id = p_user;

  insert into public.ledger_entries (user_id, type, amount_usdt)
    values (p_user, 'WITHDRAW', p_amount);
end;
$$;

-- ── lock down EXECUTE: server (service_role) only ─────────────────────────────
revoke all on function public.ledger_deposit(uuid, numeric) from public;
revoke all on function public.ledger_lock(uuid, numeric, uuid) from public;
revoke all on function public.ledger_unlock(uuid, numeric, uuid) from public;
revoke all on function public.ledger_withdraw(uuid, numeric) from public;

grant execute on function public.ledger_deposit(uuid, numeric) to service_role;
grant execute on function public.ledger_lock(uuid, numeric, uuid) to service_role;
grant execute on function public.ledger_unlock(uuid, numeric, uuid) to service_role;
grant execute on function public.ledger_withdraw(uuid, numeric) to service_role;
