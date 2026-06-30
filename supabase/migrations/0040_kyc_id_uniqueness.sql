-- 0040 — KYC identity uniqueness: one verified ID number per account
--
-- Until now a person could verify many accounts (different emails) with the SAME
-- ID + face — nothing matched identities across accounts. This captures the ID /
-- passport number and enforces "one APPROVED account per ID number" three ways:
--   • a partial UNIQUE index (the hard DB guarantee) over APPROVED rows;
--   • kyc_submit rejects a number already verified elsewhere (early, friendly);
--   • kyc_approve re-checks at approval time (the authoritative gate).
-- The number is normalised (uppercased, alphanumerics only) so "AB-123 456" and
-- "ab123456" collide. Existing approved rows keep a null number (nulls don't clash).

alter table public.kyc_submissions
  add column if not exists id_number text;

-- Hard guarantee: at most one APPROVED submission per (normalised) ID number.
-- Nulls are distinct, so legacy approved rows (no number) never conflict.
create unique index if not exists kyc_one_approved_id_number
  on public.kyc_submissions (id_number)
  where status = 'APPROVED' and id_number is not null;

-- ── kyc_submit: now also takes + normalises the ID number ────────────────────
drop function if exists public.kyc_submit(uuid, text, text, text, text);

create or replace function public.kyc_submit(
  p_user             uuid,
  p_id_document      text,
  p_id_document_back text,
  p_liveness         text,
  p_full_name        text,
  p_id_number        text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status kyc_status;
  v_id     uuid;
  v_idnum  text;
begin
  if p_id_document is null or length(btrim(p_id_document)) = 0 then
    raise exception 'front of ID is required';
  end if;
  if p_id_document_back is null or length(btrim(p_id_document_back)) = 0 then
    raise exception 'back of ID is required';
  end if;
  if p_liveness is null or length(btrim(p_liveness)) = 0 then
    raise exception 'liveness photo is required';
  end if;
  if p_full_name is null or length(btrim(p_full_name)) < 2 then
    raise exception 'full name is required';
  end if;

  -- Normalise the ID number so formatting differences can't dodge uniqueness.
  v_idnum := upper(regexp_replace(btrim(coalesce(p_id_number, '')), '[^A-Za-z0-9]', '', 'g'));
  if length(v_idnum) < 3 then
    raise exception 'a valid ID or passport number is required';
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

  -- Reject early if this ID number is already verified on a DIFFERENT account.
  if exists (
    select 1 from public.kyc_submissions s
    where s.id_number = v_idnum
      and s.status = 'APPROVED'
      and s.user_id <> p_user
  ) then
    raise exception 'this ID number is already verified on another account';
  end if;

  insert into public.kyc_submissions
      (user_id, id_document_path, id_document_back_path, liveness_path, full_name, id_number)
    values (
      p_user, btrim(p_id_document), btrim(p_id_document_back),
      btrim(p_liveness), btrim(p_full_name), v_idnum
    )
    returning id into v_id;

  update public.users set kyc_status = 'PENDING' where id = p_user;

  return v_id;
end;
$$;

revoke all on function public.kyc_submit(uuid, text, text, text, text, text) from public;
grant execute on function public.kyc_submit(uuid, text, text, text, text, text) to service_role;

-- ── kyc_approve: re-check uniqueness at the moment of approval ────────────────
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

  -- Authoritative dedup: never approve a second account for an ID number that is
  -- already verified elsewhere (the unique index is the final backstop on a race).
  if v_sub.id_number is not null and exists (
    select 1 from public.kyc_submissions s
    where s.id_number = v_sub.id_number
      and s.status = 'APPROVED'
      and s.user_id <> v_sub.user_id
  ) then
    raise exception 'this ID number is already verified on another account — cannot approve';
  end if;

  update public.kyc_submissions
    set status = 'APPROVED', reviewed_by = p_admin, reviewed_at = now()
    where id = p_id;

  update public.users set kyc_status = 'APPROVED' where id = v_sub.user_id;
end;
$$;

revoke all on function public.kyc_approve(uuid, uuid) from public;
grant execute on function public.kyc_approve(uuid, uuid) to service_role;
