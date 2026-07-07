-- 0053 — admin account moderation: ban / unban
--
-- Adds an admin-initiated ban (distinct from the automatic missed-release
-- freeze/forfeit flow). Banning:
--   • sets account_status = 'BANNED' with a reason,
--   • FREEZES the account's funds and activity — a banned user can't trade
--     (order_create already guards), transfer (internal_transfer guards), or
--     withdraw (guarded here), so their balance is preserved but immovable,
--   • HIDES the account from everyone else — the public_profiles view now only
--     exposes ACTIVE accounts, so a banned user's profile, presence, and ads all
--     disappear from other users while the underlying rows are untouched.
-- Unbanning simply restores ACTIVE and clears the ban — nothing is deleted, so
-- all their data (ads, orders, balance, reputation) comes straight back.
--
-- No data is ever destroyed: ban/unban only flip a status flag.

-- ── (1) Hide non-ACTIVE accounts from every public read ──────────────────────
-- public_profiles is the single gate other users see each other through (market
-- posters, order counterparties, presence). Restricting it to ACTIVE accounts
-- makes a banned/frozen user vanish for everyone else, with zero row deletion.
create or replace view public.public_profiles as
  select id, reputation_score, completed_trades, completion_rate,
         avg_release_seconds, is_merchant, created_at,
         full_name,
         (kyc_status = 'APPROVED') as is_verified,
         last_seen_at
  from public.users
  where account_status = 'ACTIVE';

-- ── (2) Freeze withdrawals for non-ACTIVE accounts ───────────────────────────
-- Byte-for-byte the migration 0045 withdrawal_request plus an account-standing
-- guard so a banned/frozen user cannot move funds off-platform.
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
  v_standing  text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'withdrawal amount must be positive (got %)', p_amount;
  end if;
  if p_to_address is null or length(btrim(p_to_address)) = 0 then
    raise exception 'destination address is required';
  end if;

  -- Account-standing guard: a frozen/banned account's funds are frozen in place.
  select account_status into v_standing from public.users where id = p_user;
  if coalesce(v_standing, 'ACTIVE') <> 'ACTIVE' then
    raise exception 'your account is % — withdrawals are disabled', v_standing;
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

-- ── (3) account_ban ──────────────────────────────────────────────────────────
create or replace function public.account_ban(
  p_admin  uuid,
  p_user   uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin     boolean;
  v_target_admin boolean;
  v_status       text;
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can ban an account';
  end if;
  if p_user = p_admin then
    raise exception 'you cannot ban your own account';
  end if;

  select is_admin, account_status into v_target_admin, v_status
    from public.users where id = p_user;
  if not found then
    raise exception 'account % not found', p_user;
  end if;
  if v_target_admin is true then
    raise exception 'admin accounts cannot be banned';
  end if;
  if v_status = 'BANNED' then
    raise exception 'account is already banned';
  end if;

  -- Flip the flag only — funds, ads, orders, reputation are all preserved and
  -- simply become frozen/hidden until the account is unbanned.
  update public.users
    set account_status = 'BANNED',
        frozen_at      = now(),
        ban_reason     = coalesce(nullif(btrim(p_reason), ''),
                                  'Banned by an administrator')
    where id = p_user;
end;
$$;

revoke all on function public.account_ban(uuid, uuid, text) from public;
grant execute on function public.account_ban(uuid, uuid, text) to service_role;

-- ── (4) account_unban ────────────────────────────────────────────────────────
create or replace function public.account_unban(
  p_admin uuid,
  p_user  uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin  boolean;
  v_status    text;
  v_forfeited numeric;
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can unban an account';
  end if;

  select account_status into v_status from public.users where id = p_user;
  if not found then
    raise exception 'account % not found', p_user;
  end if;
  if v_status <> 'BANNED' then
    raise exception 'account is not banned';
  end if;

  -- Accounts banned via a missed-release forfeit hold forfeited funds; those must
  -- be reinstated (account_reinstate returns the funds), not plain-unbanned.
  select usdt_forfeited into v_forfeited from public.wallets where user_id = p_user;
  if coalesce(v_forfeited, 0) > 0 then
    raise exception 'this account has forfeited funds — use Reinstate to return them and restore standing';
  end if;

  update public.users
    set account_status = 'ACTIVE',
        frozen_at      = null,
        ban_reason     = null
    where id = p_user;
end;
$$;

revoke all on function public.account_unban(uuid, uuid) from public;
grant execute on function public.account_unban(uuid, uuid) to service_role;
