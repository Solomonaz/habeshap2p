-- 0046 — HabeshaP2P ID + free internal transfers
--
-- Gives every user a short, shareable "HabeshaP2P ID" (an 8-digit account number)
-- and lets one user send USDT to another BY that ID — a pure off-chain ledger
-- move (sender available → recipient available). No blockchain, so no gas and no
-- fee. Conservation holds: the system total is unchanged (money shifts between
-- two users' available buckets).
--
-- The new function references the TRANSFER_OUT/TRANSFER_IN ledger labels added in
-- this same migration; an enum label added by ALTER TYPE can't be USED in the
-- same transaction, and CREATE FUNCTION would validate the body and choke — so
-- defer body validation (same pattern as 0012/0031). Labels resolve at runtime.
set check_function_bodies = off;

-- ── HabeshaP2P ID (public_id) ────────────────────────────────────────────────
alter table public.users add column if not exists public_id text;
create unique index if not exists users_public_id_key on public.users (public_id);

-- A random, collision-checked 8-digit account number (10000000–99999999). Random
-- (not sequential) so it doesn't leak the user count or signup order.
create or replace function public.gen_user_public_id()
returns text
language plpgsql
set search_path = public
as $$
declare
  v_id text;
begin
  loop
    v_id := (floor(random() * 90000000) + 10000000)::bigint::text;
    exit when not exists (select 1 from public.users where public_id = v_id);
  end loop;
  return v_id;
end;
$$;

-- Backfill every existing user.
do $$
declare r record;
begin
  for r in select id from public.users where public_id is null loop
    update public.users set public_id = public.gen_user_public_id() where id = r.id;
  end loop;
end $$;

-- Auto-assign on every new signup (handle_new_user inserts the row; this fills
-- the ID if the insert didn't provide one).
create or replace function public.assign_public_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.public_id is null then
    new.public_id := public.gen_user_public_id();
  end if;
  return new;
end;
$$;

drop trigger if exists users_assign_public_id on public.users;
create trigger users_assign_public_id
  before insert on public.users
  for each row execute function public.assign_public_id();

-- Every row now has one; enforce it.
alter table public.users alter column public_id set not null;

-- ── ledger labels for the transfer ───────────────────────────────────────────
alter type ledger_type add value if not exists 'TRANSFER_OUT'; -- sender available −
alter type ledger_type add value if not exists 'TRANSFER_IN';  -- recipient available +

-- ── internal_transfer: move available → available between two users ──────────
-- Free, instant, off-chain. Sender must be identity-verified and active; the
-- recipient is resolved by their HabeshaP2P ID and must be active.
create or replace function public.internal_transfer(
  p_sender       uuid,
  p_recipient_id text,
  p_amount       numeric
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rid        text;
  v_recipient  uuid;
  v_r_status   text;
  v_s_kyc      kyc_status;
  v_s_status   text;
  v_available  numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'transfer amount must be positive (got %)', p_amount;
  end if;

  -- Normalise the entered ID (strip spaces/dashes) and resolve the recipient.
  v_rid := regexp_replace(btrim(coalesce(p_recipient_id, '')), '[^0-9]', '', 'g');
  if length(v_rid) = 0 then
    raise exception 'enter the recipient''s HabeshaP2P ID';
  end if;

  select id, account_status into v_recipient, v_r_status
    from public.users where public_id = v_rid;
  if not found then
    raise exception 'no account with HabeshaP2P ID %', v_rid;
  end if;
  if v_recipient = p_sender then
    raise exception 'you can''t transfer to your own account';
  end if;
  if v_r_status <> 'ACTIVE' then
    raise exception 'the recipient account is not active';
  end if;

  -- Sender must be verified + active to move money.
  select kyc_status, account_status into v_s_kyc, v_s_status
    from public.users where id = p_sender;
  if v_s_status <> 'ACTIVE' then
    raise exception 'your account is not active';
  end if;
  if v_s_kyc <> 'APPROVED' then
    raise exception 'complete identity verification before sending funds';
  end if;

  -- Lock both wallets (consistent order: sender then recipient is fine — the pair
  -- is disjoint from any single-wallet path). Check funds under the lock.
  select usdt_available into v_available
    from public.wallets where user_id = p_sender for update;
  if not found then
    raise exception 'sender wallet not found';
  end if;
  if v_available < p_amount then
    raise exception 'insufficient available balance: have %, need %',
      v_available, p_amount;
  end if;
  perform 1 from public.wallets where user_id = v_recipient for update;

  update public.wallets
    set usdt_available = usdt_available - p_amount
    where user_id = p_sender;
  update public.wallets
    set usdt_available = usdt_available + p_amount
    where user_id = v_recipient;

  insert into public.ledger_entries (user_id, type, amount_usdt) values
    (p_sender,    'TRANSFER_OUT', p_amount),
    (v_recipient, 'TRANSFER_IN',  p_amount);

  return v_recipient;
end;
$$;

revoke all on function public.internal_transfer(uuid, text, numeric) from public;
grant execute on function public.internal_transfer(uuid, text, numeric) to service_role;
