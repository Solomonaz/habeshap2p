-- 0027 — admin appeal: reinstate a permanently-banned seller (Phase 10)
--
-- Why this exists (the user's explicit request): the missed-release flow can ban
-- an HONEST seller. Example: a buyer clicks "I paid the birr" without actually
-- paying, the seller correctly refuses to release, the window elapses, the seller
-- is auto-frozen, and an admin — misreading the case — rules FAVOUR_BUYER. That
-- forfeits the seller's funds and permanently bans them, with no recourse.
--
-- This migration adds the reverse path so an admin can REINSTATE a wrongly-banned
-- account on appeal: it returns the funds the platform forfeited from that seller
-- (platform_account.usdt_forfeited -> the seller's usdt_available) and flips the
-- account back to ACTIVE so they can trade again.
--
-- SCOPE NOTE (intentional): reinstatement reverses the SELLER-side penalty — the
-- forfeited wallet + the ban. It does NOT claw back the disputed order's escrow
-- that was released to the buyer; that USDT may already have been withdrawn, so
-- reversing it automatically is unsafe. If a buyer defrauded the platform, that
-- recovery is handled separately (out of scope here). The order/dispute records
-- stay intact as the permanent audit trail.
--
-- Conservation is preserved: every micro returned to the seller is removed from
-- platform_account.usdt_forfeited in the same transaction, with a matching
-- UNFORFEIT ledger entry. The invariant from 0025 still holds.
--
-- PG GOTCHA (same as 0025): the new 'UNFORFEIT' enum literal cannot be *used* in
-- the same transaction it is added in, so we disable body validation; the literal
-- is only evaluated at call time.
set check_function_bodies = off;

-- ── new ledger type: reversal of a forfeiture ────────────────────────────────
alter type ledger_type add value if not exists 'UNFORFEIT';

-- ── account_reinstate: undo a permanent ban on appeal ────────────────────────
-- Admin-only. Acts only on a BANNED account. Returns the net amount this user
-- still has forfeited to the platform (sum of FORFEIT minus any prior UNFORFEIT),
-- moves it from the platform's forfeiture bucket back to the seller's available
-- balance, records an UNFORFEIT ledger entry, and reactivates the account.
-- Returns the USDT amount returned (0 if nothing was forfeited). Idempotent in
-- spirit: a second call no-ops because the account is no longer BANNED.
create or replace function public.account_reinstate(
  p_user  uuid,
  p_admin uuid
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_status   text;
  v_refund   numeric(20, 6);
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can reinstate an account';
  end if;

  select account_status into v_status
    from public.users where id = p_user for update;
  if not found then
    raise exception 'user % not found', p_user;
  end if;
  if coalesce(v_status, 'ACTIVE') <> 'BANNED' then
    raise exception 'account % is % — reinstate applies only to a banned account',
      p_user, coalesce(v_status, 'ACTIVE');
  end if;

  -- The net forfeited still held by the platform for this user.
  select coalesce(sum(
           case type
             when 'FORFEIT'   then amount_usdt
             when 'UNFORFEIT' then -amount_usdt
             else 0
           end), 0)
    into v_refund
    from public.ledger_entries
    where user_id = p_user and type in ('FORFEIT', 'UNFORFEIT');

  if v_refund < 0 then
    v_refund := 0;  -- defensive: never let bookkeeping drift create a phantom debit
  end if;

  -- Return the forfeited funds: platform bucket -> seller available.
  if v_refund > 0 then
    perform 1 from public.platform_account where id for update;
    perform 1 from public.wallets where user_id = p_user for update;
    update public.platform_account
      set usdt_forfeited = usdt_forfeited - v_refund where id;
    update public.wallets
      set usdt_available = usdt_available + v_refund where user_id = p_user;
    insert into public.ledger_entries (user_id, type, amount_usdt)
      values (p_user, 'UNFORFEIT', v_refund);
  end if;

  -- Reactivate the account. Merchant standing is NOT auto-restored: the bond was
  -- swept and is now plain available balance, so they must re-bond to merchant.
  update public.users
    set account_status = 'ACTIVE',
        frozen_at      = null,
        ban_reason     = null
    where id = p_user;

  return v_refund;
end;
$$;

revoke all on function public.account_reinstate(uuid, uuid) from public;
grant execute on function public.account_reinstate(uuid, uuid) to service_role;
