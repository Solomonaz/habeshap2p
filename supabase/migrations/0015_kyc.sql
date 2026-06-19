-- 0015 — KYC: manual identity verification gate
--
-- Stage 2 of the auth rework. Before a user can trade, post an ad, or withdraw,
-- they must upload a government-issued ID and a liveness selfie, which an admin
-- reviews by hand (no paid KYC provider — this is the cheap-MVP path the user
-- chose). Verification has four states; trading is hard-blocked at the DATABASE
-- level (triggers below) so an unverified user can never reach escrow even if a
-- UI check is bypassed.

-- ── verification status ──────────────────────────────────────────────────────
--   UNVERIFIED — fresh account, never submitted (default)
--   PENDING    — submitted, waiting on an admin
--   APPROVED   — admin cleared it; trading unlocked
--   REJECTED   — admin denied it; the user may resubmit
create type kyc_status as enum ('UNVERIFIED', 'PENDING', 'APPROVED', 'REJECTED');

alter table public.users
  add column kyc_status kyc_status not null default 'UNVERIFIED';

-- ── submissions ──────────────────────────────────────────────────────────────
-- One row per attempt (kept as an audit trail; the latest row reflects the
-- current state mirrored onto users.kyc_status). Document paths point at objects
-- in the private `kyc` storage bucket — never the images themselves.
create table public.kyc_submissions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users (id) on delete cascade,
  id_document_path text not null,
  liveness_path    text not null,
  -- The legal name the user attests to here, captured at submission time so a
  -- later profile edit can't silently diverge from what the admin reviewed.
  full_name        text not null,
  status           kyc_status not null default 'PENDING',
  rejection_reason text,
  reviewed_by      uuid references public.users (id),
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now()
);

create index kyc_submissions_user_idx on public.kyc_submissions (user_id, created_at desc);
create index kyc_submissions_pending_idx on public.kyc_submissions (created_at)
  where status = 'PENDING';

alter table public.kyc_submissions enable row level security;

grant select on public.kyc_submissions to authenticated;
-- No client insert/update: submissions are created and transitioned only through
-- the SECURITY DEFINER RPCs below (which set users.kyc_status atomically).

create policy kyc_submissions_select_own on public.kyc_submissions
  for select to authenticated
  using (user_id = auth.uid());

create policy kyc_submissions_select_admin on public.kyc_submissions
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.is_admin
    )
  );

-- ── guard kyc_status ──────────────────────────────────────────────────────────
-- Verification state is decided only by the review RPCs. A client must not be
-- able to mark itself APPROVED via a profile update, so fold it into the guard.
create or replace function public.guard_users_protected_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    if new.reputation_score      is distinct from old.reputation_score
       or new.completed_trades    is distinct from old.completed_trades
       or new.completion_rate     is distinct from old.completion_rate
       or new.avg_release_seconds is distinct from old.avg_release_seconds
       or new.is_merchant         is distinct from old.is_merchant
       or new.is_admin            is distinct from old.is_admin
       or new.email               is distinct from old.email
       or new.telegram_id         is distinct from old.telegram_id
       or new.telegram_username   is distinct from old.telegram_username
       or new.kyc_status          is distinct from old.kyc_status then
      raise exception 'Protected user columns can only be modified server-side';
    end if;
  end if;
  return new;
end;
$$;

-- ── private storage bucket for KYC images ─────────────────────────────────────
-- IDs and selfies are highly sensitive, so the bucket is PRIVATE: the app serves
-- them only through short-lived signed URLs. Object key convention:
-- `<user_id>/<random>.<ext>` — the first path segment is the owner, which the
-- policies use to scope access.
insert into storage.buckets (id, name, public)
  values ('kyc', 'kyc', false)
  on conflict (id) do nothing;

-- A user may read their own objects; an admin may read anyone's (to review).
create policy "kyc_read_own_or_admin"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'kyc'
    and (
      ((storage.foldername(name))[1])::uuid = auth.uid()
      or exists (
        select 1 from public.users u
        where u.id = auth.uid() and u.is_admin
      )
    )
  );

create policy "kyc_write_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'kyc'
    and owner = auth.uid()
    and ((storage.foldername(name))[1])::uuid = auth.uid()
  );

-- No update/delete policies: submitted documents are immutable evidence.

-- ── kyc_submit: user files an attempt; account moves to PENDING ───────────────
-- Callable only when the user has not already been approved and is not already
-- pending (one open submission at a time). Runs as the authenticated user (the
-- TS layer passes the session user id), never trusting client-supplied ids.
create or replace function public.kyc_submit(
  p_user           uuid,
  p_id_document    text,
  p_liveness       text,
  p_full_name      text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status kyc_status;
  v_id     uuid;
begin
  if p_id_document is null or length(btrim(p_id_document)) = 0 then
    raise exception 'id document is required';
  end if;
  if p_liveness is null or length(btrim(p_liveness)) = 0 then
    raise exception 'liveness photo is required';
  end if;
  if p_full_name is null or length(btrim(p_full_name)) < 2 then
    raise exception 'full name is required';
  end if;

  select kyc_status into v_status from public.users where id = p_user for update;
  if not found then
    raise exception 'user % not found', p_user;
  end if;
  if v_status = 'APPROVED' then
    raise exception 'account is already verified';
  end if;
  if v_status = 'PENDING' then
    raise exception 'a verification request is already under review';
  end if;

  insert into public.kyc_submissions (user_id, id_document_path, liveness_path, full_name)
    values (p_user, btrim(p_id_document), btrim(p_liveness), btrim(p_full_name))
    returning id into v_id;

  update public.users set kyc_status = 'PENDING' where id = p_user;

  return v_id;
end;
$$;

-- ── kyc_approve: ADMIN clears a pending submission ────────────────────────────
create or replace function public.kyc_approve(
  p_id    uuid,
  p_admin uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_sub      public.kyc_submissions%rowtype;
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can approve a verification';
  end if;

  select * into v_sub from public.kyc_submissions where id = p_id for update;
  if not found then raise exception 'submission % not found', p_id; end if;
  if v_sub.status <> 'PENDING' then
    raise exception 'submission % is % — not pending', p_id, v_sub.status;
  end if;

  update public.kyc_submissions
    set status = 'APPROVED', reviewed_by = p_admin, reviewed_at = now()
    where id = p_id;

  update public.users set kyc_status = 'APPROVED' where id = v_sub.user_id;
end;
$$;

-- ── kyc_reject: ADMIN denies; the user may resubmit ───────────────────────────
create or replace function public.kyc_reject(
  p_id     uuid,
  p_admin  uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_sub      public.kyc_submissions%rowtype;
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can reject a verification';
  end if;

  select * into v_sub from public.kyc_submissions where id = p_id for update;
  if not found then raise exception 'submission % not found', p_id; end if;
  if v_sub.status <> 'PENDING' then
    raise exception 'submission % is % — not pending', p_id, v_sub.status;
  end if;

  update public.kyc_submissions
    set status = 'REJECTED', reviewed_by = p_admin, reviewed_at = now(),
        rejection_reason = nullif(btrim(coalesce(p_reason, '')), '')
    where id = p_id;

  -- Back to REJECTED (not UNVERIFIED) so the UI can show the reason; kyc_submit
  -- treats REJECTED the same as UNVERIFIED and lets the user try again.
  update public.users set kyc_status = 'REJECTED' where id = v_sub.user_id;
end;
$$;

-- ── hard gate: only APPROVED users may trade, post ads, or withdraw ───────────
-- Enforced at the table level via BEFORE INSERT triggers so the rule holds no
-- matter the write path: ads are a direct RLS insert, orders/withdrawals run
-- through SECURITY DEFINER RPCs. Both parties of an order must be approved.
create or replace function public.require_kyc_approved(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status kyc_status;
begin
  select kyc_status into v_status from public.users where id = p_user;
  if v_status is distinct from 'APPROVED' then
    raise exception 'account % must complete identity verification first', p_user
      using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function public.gate_ads_kyc()
returns trigger
language plpgsql
as $$
begin
  perform public.require_kyc_approved(new.user_id);
  return new;
end;
$$;

create trigger ads_require_kyc
  before insert on public.ads
  for each row execute function public.gate_ads_kyc();

create or replace function public.gate_orders_kyc()
returns trigger
language plpgsql
as $$
begin
  perform public.require_kyc_approved(new.buyer_id);
  perform public.require_kyc_approved(new.seller_id);
  return new;
end;
$$;

create trigger orders_require_kyc
  before insert on public.orders
  for each row execute function public.gate_orders_kyc();

create or replace function public.gate_withdrawals_kyc()
returns trigger
language plpgsql
as $$
begin
  perform public.require_kyc_approved(new.user_id);
  return new;
end;
$$;

create trigger withdrawals_require_kyc
  before insert on public.withdrawals
  for each row execute function public.gate_withdrawals_kyc();

-- ── grants ────────────────────────────────────────────────────────────────────
-- The TS layer invokes these through the service-role client (like every other
-- RPC), passing the authenticated user/admin id; revoke the public default.
revoke all on function public.kyc_submit(uuid, text, text, text) from public;
revoke all on function public.kyc_approve(uuid, uuid) from public;
revoke all on function public.kyc_reject(uuid, uuid, text) from public;

grant execute on function public.kyc_submit(uuid, text, text, text) to service_role;
grant execute on function public.kyc_approve(uuid, uuid) to service_role;
grant execute on function public.kyc_reject(uuid, uuid, text) to service_role;
