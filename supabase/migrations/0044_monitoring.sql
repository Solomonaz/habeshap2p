-- 0044 — launch monitoring support: cron heartbeats + a solvency (liabilities) sum
--
-- Backs the pre-flight check page and the monitoring cron:
--   • cron_heartbeats — each background job stamps its last run here so we can tell
--     the schedulers are actually firing (a dead poller = deposits never credit).
--   • platform_liabilities_usdt() — the exact total USDT the platform OWES users
--     (every wallet bucket), to compare against the on-chain hot-wallet balance so
--     under-reserving (insolvency) is caught before it hurts anyone.

-- ── cron heartbeats ──────────────────────────────────────────────────────────
create table if not exists public.cron_heartbeats (
  name        text primary key,
  last_run_at timestamptz not null default now(),
  last_ok     boolean not null default true,
  runs        bigint not null default 0
);

-- Locked down: only the service role (which bypasses RLS) reads/writes these.
alter table public.cron_heartbeats enable row level security;

create or replace function public.record_cron_run(p_name text, p_ok boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.cron_heartbeats (name, last_run_at, last_ok, runs)
    values (p_name, now(), coalesce(p_ok, true), 1)
    on conflict (name) do update
      set last_run_at = now(),
          last_ok     = coalesce(p_ok, true),
          runs        = public.cron_heartbeats.runs + 1;
end;
$$;

revoke all on function public.record_cron_run(text, boolean) from public;
grant execute on function public.record_cron_run(text, boolean) to service_role;

-- ── solvency: total user-owed USDT ───────────────────────────────────────────
-- Sum of every liability bucket across all wallets. Returned as text so the exact
-- decimal is preserved (never a float). The on-chain hot-wallet USDT must cover it.
create or replace function public.platform_liabilities_usdt()
returns text
language sql
security definer
set search_path = public
as $$
  select coalesce(
    sum(
      usdt_available + usdt_locked + usdt_bond
      + usdt_withdraw_locked + usdt_frozen
    ), 0
  )::text
  from public.wallets;
$$;

revoke all on function public.platform_liabilities_usdt() from public;
grant execute on function public.platform_liabilities_usdt() to service_role;
