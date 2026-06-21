-- 0018 — platform settings: the admin-controlled "live payments" switch (Phase 9)
--
-- Until now the only path to a balance credit was the DEV FAUCET (mints test USDT
-- out of thin air, hard-blocked in production). This migration adds a single
-- runtime switch the admin flips from the console to move the platform from
-- TEST mode (dev faucet + the no-network stub chain provider) to LIVE mode
-- (faucet gone; real Tron deposits/withdrawals through the configured provider).
--
--   live_payments = false  →  TEST  (default — never auto-go-live)
--   live_payments = true   →  LIVE  (real on-chain money)
--
-- The flag is a SINGLETON row (id = true), mirroring platform_account in 0013.
-- It is written ONLY through set_live_payments, which re-checks is_admin
-- (defence in depth — the server action already gates, the SQL gates again).
-- Admins may READ it (for the toggle UI); the service role reads it server-side
-- to pick the chain provider. No client may write it.

create table if not exists public.platform_settings (
  id            boolean primary key default true check (id = true),
  live_payments boolean not null default false,
  updated_by    uuid references public.users (id),
  updated_at    timestamptz not null default now()
);

-- Seed the singleton row in TEST mode. Safe to re-run.
insert into public.platform_settings (id, live_payments)
  values (true, false)
  on conflict (id) do nothing;

alter table public.platform_settings enable row level security;
grant select on public.platform_settings to authenticated;

-- Admins may READ the switch (to render the toggle). Nobody writes from the
-- client — the only writer is set_live_payments via the service role.
drop policy if exists platform_settings_select_admin on public.platform_settings;
create policy platform_settings_select_admin on public.platform_settings
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.is_admin = true
    )
  );

-- ── set_live_payments: ADMIN flips the switch ───────────────────────────────
-- Re-checks is_admin (a non-admin id can never change the mode even if it
-- somehow reached here). Upserts the singleton and stamps who/when. Returns the
-- value now in effect.
create or replace function public.set_live_payments(
  p_admin   uuid,
  p_enabled boolean
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can change the payments mode';
  end if;
  if p_enabled is null then
    raise exception 'payments mode is required';
  end if;

  insert into public.platform_settings (id, live_payments, updated_by, updated_at)
    values (true, p_enabled, p_admin, now())
    on conflict (id) do update
      set live_payments = excluded.live_payments,
          updated_by    = excluded.updated_by,
          updated_at    = excluded.updated_at;

  return p_enabled;
end;
$$;

-- ── EXECUTE: server (service_role) only ──────────────────────────────────────
revoke all on function public.set_live_payments(uuid, boolean) from public;
grant execute on function public.set_live_payments(uuid, boolean) to service_role;
