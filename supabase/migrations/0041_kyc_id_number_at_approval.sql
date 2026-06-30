-- 0041 — capture the ID number at ADMIN REVIEW time, not user submission
--
-- 0040 had the *user* type their own ID number on the verify form. That's the
-- wrong trust model: a user could mistype or deliberately alter the number to
-- dodge the "one account per ID" rule. Instead the ADMIN reads the number off
-- the uploaded ID image and enters it while reviewing — and the system tells
-- the admin, right there, if that number is already verified on another
-- account, so they reject the duplicate.
--
-- We keep the `id_number` column and the partial unique index from 0040. What
-- changes: kyc_submit no longer takes a number (back to the 5-arg form), and
-- kyc_approve now REQUIRES the admin-entered number, normalises it, blocks
-- duplicates, and stores it on the row at the moment of approval. A read-only
-- helper lets the review UI warn the admin live as they type.

-- ── shared normaliser: uppercase, alphanumerics only ─────────────────────────
-- So "AB-123 456", "ab123456", "AB123456" all collide. Used by the approval
-- gate AND the live check, so both judge identity the exact same way.
create or replace function public.kyc_normalize_id_number(p_id_number text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(btrim(coalesce(p_id_number, '')), '[^A-Za-z0-9]', '', 'g'));
$$;

-- ── kyc_submit: revert to the 5-arg form (user no longer enters a number) ─────
drop function if exists public.kyc_submit(uuid, text, text, text, text, text);

create or replace function public.kyc_submit(
  p_user             uuid,
  p_id_document      text,
  p_id_document_back text,
  p_liveness         text,
  p_full_name        text
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

  insert into public.kyc_submissions
      (user_id, id_document_path, id_document_back_path, liveness_path, full_name)
    values (
      p_user, btrim(p_id_document), btrim(p_id_document_back),
      btrim(p_liveness), btrim(p_full_name)
    )
    returning id into v_id;

  update public.users set kyc_status = 'PENDING' where id = p_user;

  return v_id;
end;
$$;

revoke all on function public.kyc_submit(uuid, text, text, text, text) from public;
grant execute on function public.kyc_submit(uuid, text, text, text, text) to service_role;

-- ── kyc_id_number_taken: read-only check for the admin review UI ──────────────
-- Returns true if some OTHER account already has an APPROVED submission with the
-- same (normalised) number. Excludes p_exclude_user so re-reviewing the same
-- person never flags itself.
create or replace function public.kyc_id_number_taken(
  p_id_number    text,
  p_exclude_user uuid
) returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.kyc_submissions s
    where s.status = 'APPROVED'
      and s.id_number is not null
      and s.id_number = public.kyc_normalize_id_number(p_id_number)
      and s.user_id <> p_exclude_user
  );
$$;

revoke all on function public.kyc_id_number_taken(text, uuid) from public;
grant execute on function public.kyc_id_number_taken(text, uuid) to service_role;

-- ── kyc_approve: admin enters + the number is normalised, deduped, stored ─────
drop function if exists public.kyc_approve(uuid, uuid);

create or replace function public.kyc_approve(
  p_id        uuid,
  p_admin     uuid,
  p_id_number text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_sub      public.kyc_submissions%rowtype;
  v_idnum    text;
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can approve a verification';
  end if;

  -- The admin must record the ID number off the document; uniqueness depends on it.
  v_idnum := public.kyc_normalize_id_number(p_id_number);
  if length(v_idnum) < 3 then
    raise exception 'enter the ID or passport number from the document before approving';
  end if;

  select * into v_sub from public.kyc_submissions where id = p_id for update;
  if not found then raise exception 'submission % not found', p_id; end if;
  if v_sub.status <> 'PENDING' then
    raise exception 'submission % is % — not pending', p_id, v_sub.status;
  end if;

  -- Authoritative dedup: never approve a second account for an ID number that is
  -- already verified elsewhere (the unique index is the final backstop on a race).
  if exists (
    select 1 from public.kyc_submissions s
    where s.id_number = v_idnum
      and s.status = 'APPROVED'
      and s.user_id <> v_sub.user_id
  ) then
    raise exception 'this ID number is already verified on another account — reject this submission';
  end if;

  update public.kyc_submissions
    set status = 'APPROVED',
        id_number = v_idnum,
        reviewed_by = p_admin,
        reviewed_at = now()
    where id = p_id;

  update public.users set kyc_status = 'APPROVED' where id = v_sub.user_id;
end;
$$;

revoke all on function public.kyc_approve(uuid, uuid, text) from public;
grant execute on function public.kyc_approve(uuid, uuid, text) to service_role;
