-- 0036 — unmatched pooled-deposit reconciliation queue
--
-- In pooled (omnibus) mode a deposit is attributed by an exact unique amount. When
-- a transfer arrives that matches NO deposit intent — the depositor sent a round
-- number, an exchange deducted a fee, a wallet truncated the decimals — the poller
-- previously only logged it (lost in the cron logs). This persists those transfers
-- so an admin can see them and credit the right user (or ignore noise/dust).
--
-- The poller records each unmatched transfer here (idempotent on tx_hash). An admin
-- then credits it to a user (reuses credit_deposit, which dedupes on tx_hash) or
-- ignores it. All writes go through the SECURITY DEFINER RPCs / service role.

create table if not exists public.unmatched_deposits (
  id               uuid primary key default gen_random_uuid(),
  tx_hash          text not null unique,
  to_address       text not null,
  amount_usdt      numeric(20, 6) not null check (amount_usdt > 0),
  status           text not null default 'PENDING'
                     check (status in ('PENDING', 'CREDITED', 'IGNORED')),
  credited_user_id uuid references public.users (id),
  resolved_by      uuid references public.users (id),
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz
);
create index if not exists unmatched_deposits_status_idx
  on public.unmatched_deposits (status, created_at);

-- Admin-only: never exposed to clients. Reads + writes go through the service role
-- and the admin-gated RPCs below.
alter table public.unmatched_deposits enable row level security;
revoke all on table public.unmatched_deposits from anon, authenticated;

-- ── record_unmatched_deposit: poller logs a transfer that matched no intent ───
-- Idempotent: re-polling the same tx is a no-op. Returns true only the FIRST time
-- (so the poller can alert admins once, not every 5 minutes).
create or replace function public.record_unmatched_deposit(
  p_tx_hash    text,
  p_amount     numeric,
  p_to_address text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new boolean;
begin
  insert into public.unmatched_deposits (tx_hash, amount_usdt, to_address)
    values (btrim(p_tx_hash), p_amount, btrim(p_to_address))
    on conflict (tx_hash) do nothing
    returning true into v_new;
  return coalesce(v_new, false);
end;
$$;

revoke all on function public.record_unmatched_deposit(text, numeric, text) from public;
grant execute on function public.record_unmatched_deposit(text, numeric, text) to service_role;

-- ── credit_unmatched_deposit: admin attributes a stuck transfer to a user ─────
-- Re-checks is_admin (defence in depth). Credits the ACTUAL arrived amount to the
-- chosen user via credit_deposit (idempotent on tx_hash), then marks the row
-- CREDITED. Returns the credited amount.
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
  if v_row.status <> 'PENDING' then
    raise exception 'unmatched deposit % is already %', p_tx_hash, v_row.status;
  end if;

  perform 1 from public.users where id = p_user;
  if not found then raise exception 'target user % not found', p_user; end if;

  -- credit_deposit dedupes on tx_hash, so this can never double-credit.
  perform public.credit_deposit(p_user, v_row.tx_hash, v_row.amount_usdt);

  update public.unmatched_deposits
    set status = 'CREDITED', credited_user_id = p_user,
        resolved_by = p_admin, resolved_at = now()
    where id = v_row.id;

  return v_row.amount_usdt;
end;
$$;

revoke all on function public.credit_unmatched_deposit(uuid, text, uuid) from public;
grant execute on function public.credit_unmatched_deposit(uuid, text, uuid) to service_role;

-- ── ignore_unmatched_deposit: admin dismisses a transfer (dust/noise) ─────────
create or replace function public.ignore_unmatched_deposit(
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
    raise exception 'only an admin can ignore an unmatched deposit';
  end if;

  update public.unmatched_deposits
    set status = 'IGNORED', resolved_by = p_admin, resolved_at = now()
    where tx_hash = btrim(p_tx_hash) and status = 'PENDING';
end;
$$;

revoke all on function public.ignore_unmatched_deposit(uuid, text) from public;
grant execute on function public.ignore_unmatched_deposit(uuid, text) to service_role;
