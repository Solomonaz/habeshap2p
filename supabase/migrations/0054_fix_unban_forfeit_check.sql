-- 0054 — fix account_unban's forfeited-funds guard
--
-- 0053 checked wallets.usdt_forfeited, but that column lives on platform_account
-- (a global bucket), not per-user. Per-user forfeiture is recorded as FORFEIT /
-- UNFORFEIT ledger entries (same source fetchModeratedAccounts uses). Recompute
-- the guard from the ledger so a plain unban still refuses forfeit-banned
-- accounts (those must be Reinstated, which returns the funds).

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

  -- Net forfeited (FORFEIT minus any UNFORFEIT) for this user. > 0 means the ban
  -- came from a missed-release forfeit; route the admin to Reinstate instead so
  -- the funds are returned.
  select coalesce(sum(
           case when type = 'FORFEIT'   then amount_usdt
                when type = 'UNFORFEIT' then -amount_usdt
                else 0 end), 0)
    into v_forfeited
    from public.ledger_entries
    where user_id = p_user and type in ('FORFEIT', 'UNFORFEIT');

  if v_forfeited > 0 then
    raise exception 'this account has forfeited funds — use Reinstate to return them and restore standing';
  end if;

  update public.users
    set account_status = 'ACTIVE',
        frozen_at      = null,
        ban_reason     = null
    where id = p_user;
end;
$$;
