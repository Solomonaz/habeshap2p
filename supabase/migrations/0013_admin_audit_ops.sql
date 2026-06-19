-- 0013 — admin audit log + platform ops stats (Phase 8)
--
-- Phase 8 is production hardening + an ops console. Two server-side facilities:
--
--   1. admin_audit_log — an append-only record of every privileged action an
--      admin takes (dispute rulings, withdrawal approvals/rejections). The
--      money-moving SQL already writes ledger lines; this adds a human-readable,
--      who-did-what-when trail that survives even if a row is later changed.
--      Flagged as a gap in Phase 5 — closed here.
--
--   2. platform_stats() — a single service-role read that totals every balance
--      bucket and the open-work counts for the ops dashboard, plus the live
--      conservation figure (sum of user-owned buckets + platform fees). Amounts
--      are returned as exact decimal TEXT so JSON float rounding can't creep into
--      a reconciliation number.
--
-- Both are service-role only. The audit log is readable by admins (RLS) for the
-- console; nobody can write or mutate it from the client.

-- ── admin_audit_log: append-only privileged-action trail ─────────────────────
create table if not exists public.admin_audit_log (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid not null references public.users (id),
  action      text not null check (length(btrim(action)) > 0),
  target_type text,                       -- e.g. 'dispute', 'withdrawal'
  target_id   text,                       -- the affected row id (as text)
  detail      text,                       -- short human-readable summary
  created_at  timestamptz not null default now()
);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_admin_idx on public.admin_audit_log (admin_id, created_at desc);

alter table public.admin_audit_log enable row level security;
grant select on public.admin_audit_log to authenticated;
drop policy if exists admin_audit_log_select_admin on public.admin_audit_log;
-- Admins may READ the trail (for the console). No one may insert/update/delete
-- from the client — entries are written only by record_admin_action via the
-- service role. There is deliberately no UPDATE/DELETE policy, so the log is
-- append-only even to admins through the API.
create policy admin_audit_log_select_admin on public.admin_audit_log
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.is_admin = true
    )
  );

-- ── record_admin_action: write one audit entry (admin-gated) ─────────────────
-- Re-checks is_admin (defence in depth — the caller is already gated, but this
-- guarantees a non-admin id can never appear in the trail). Returns the new id.
create or replace function public.record_admin_action(
  p_admin       uuid,
  p_action      text,
  p_target_type text default null,
  p_target_id   text default null,
  p_detail      text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_id       uuid;
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can record an admin action';
  end if;
  if p_action is null or length(btrim(p_action)) = 0 then
    raise exception 'action is required';
  end if;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, detail)
    values (p_admin, btrim(p_action), p_target_type, p_target_id, p_detail)
    returning id into v_id;
  return v_id;
end;
$$;

-- ── platform_stats: one-shot ops snapshot (service-role only) ────────────────
-- Totals every balance bucket and the platform fee account, plus counts of open
-- work. `liabilities` is what the platform owes users (every user-owned bucket);
-- `total_supply` adds the platform's own fees — this is the conserved figure
-- that should equal (sum of deposits − broadcast withdrawals). Returned as a
-- single jsonb object with amounts as TEXT to keep them exact.
create or replace function public.platform_stats()
returns jsonb
language sql
security definer
set search_path = public
as $$
  with bal as (
    select
      coalesce(sum(usdt_available), 0)       as available,
      coalesce(sum(usdt_locked), 0)          as locked,
      coalesce(sum(usdt_bond), 0)            as bond,
      coalesce(sum(usdt_withdraw_locked), 0) as withdraw_locked
    from public.wallets
  ),
  fees as (
    select coalesce(usdt_fees, 0) as fees
    from public.platform_account where id = true
  )
  select jsonb_build_object(
    'available',       (select available::text from bal),
    'locked',          (select locked::text from bal),
    'bond',            (select bond::text from bal),
    'withdraw_locked', (select withdraw_locked::text from bal),
    'platform_fees',   (select coalesce((select fees from fees), 0)::text),
    'liabilities',
      (select (available + locked + bond + withdraw_locked)::text from bal),
    'total_supply',
      (select (available + locked + bond + withdraw_locked
               + coalesce((select fees from fees), 0))::text from bal),
    'user_count',           (select count(*) from public.users),
    'merchant_count',       (select count(*) from public.users where is_merchant),
    'active_ad_count',      (select count(*) from public.ads where status = 'ACTIVE'),
    'open_order_count',
      (select count(*) from public.orders where state in ('CREATED','PAID','DISPUTED')),
    'open_dispute_count',   (select count(*) from public.disputes where status <> 'RESOLVED'),
    'pending_withdrawal_count',
      (select count(*) from public.withdrawals where status = 'PENDING_APPROVAL')
  );
$$;

-- ── EXECUTE: server (service_role) only ──────────────────────────────────────
revoke all on function public.record_admin_action(uuid, text, text, text, text) from public;
revoke all on function public.platform_stats() from public;

grant execute on function public.record_admin_action(uuid, text, text, text, text) to service_role;
grant execute on function public.platform_stats() to service_role;
