-- 0037 — unmatched-deposit recovery + ignore reason
--
-- Hardening the reconciliation queue (0036):
--   • crediting now works on an IGNORED row too, so an accidentally-ignored real
--     deposit can be recovered in one click (only a CREDITED row is off-limits).
--   • unignore sends a row back to the PENDING queue.
--   • ignore records an optional reason for the audit trail / history view.

alter table public.unmatched_deposits
  add column if not exists resolution_note text;

-- ── credit_unmatched_deposit: now accepts PENDING *or* IGNORED ────────────────
create or replace function public.credit_unmatched_deposit(
  p_admin   uuid,
  p_tx_hash text,
  p_user    uuid
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_row      public.unmatched_deposits%rowtype;
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can credit an unmatched deposit';
  end if;

  select * into v_row from public.unmatched_deposits
    where tx_hash = btrim(p_tx_hash) for update;
  if not found then raise exception 'no unmatched deposit for tx %', p_tx_hash; end if;
  -- Only a real double-credit is blocked; a PENDING or previously-IGNORED row can
  -- be credited (recovering a mistaken ignore).
  if v_row.status = 'CREDITED' then
    raise exception 'unmatched deposit % is already credited', p_tx_hash;
  end if;

  perform 1 from public.users where id = p_user;
  if not found then raise exception 'target user % not found', p_user; end if;

  -- credit_deposit dedupes on tx_hash, so this can never double-credit.
  perform public.credit_deposit(p_user, v_row.tx_hash, v_row.amount_usdt);

  update public.unmatched_deposits
    set status = 'CREDITED', credited_user_id = p_user,
        resolved_by = p_admin, resolved_at = now(), resolution_note = null
    where id = v_row.id;

  return v_row.amount_usdt;
end;
$$;

revoke all on function public.credit_unmatched_deposit(uuid, text, uuid) from public;
grant execute on function public.credit_unmatched_deposit(uuid, text, uuid) to service_role;

-- ── ignore_unmatched_deposit: now takes a reason (replaces the 2-arg version) ─
drop function if exists public.ignore_unmatched_deposit(uuid, text);
create or replace function public.ignore_unmatched_deposit(
  p_admin   uuid,
  p_tx_hash text,
  p_reason  text default null
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
    raise exception 'only an admin can ignore an unmatched deposit';
  end if;

  update public.unmatched_deposits
    set status = 'IGNORED', resolved_by = p_admin, resolved_at = now(),
        resolution_note = nullif(btrim(p_reason), '')
    where tx_hash = btrim(p_tx_hash) and status = 'PENDING';
end;
$$;

revoke all on function public.ignore_unmatched_deposit(uuid, text, text) from public;
grant execute on function public.ignore_unmatched_deposit(uuid, text, text) to service_role;

-- ── unignore_unmatched_deposit: send an ignored row back to the queue ─────────
create or replace function public.unignore_unmatched_deposit(
  p_admin   uuid,
  p_tx_hash text
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
    raise exception 'only an admin can un-ignore an unmatched deposit';
  end if;

  update public.unmatched_deposits
    set status = 'PENDING', resolved_by = null, resolved_at = null,
        resolution_note = null
    where tx_hash = btrim(p_tx_hash) and status = 'IGNORED';
end;
$$;

revoke all on function public.unignore_unmatched_deposit(uuid, text) from public;
grant execute on function public.unignore_unmatched_deposit(uuid, text) to service_role;
