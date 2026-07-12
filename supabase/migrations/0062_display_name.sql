-- 0062 — user-chosen display name (nickname), Binance-style.
--
-- Traders can pick a cosmetic marketplace nickname shown in the order book and on
-- the trade/order counterparty header. It NEVER replaces the verified legal name
-- where identity actually matters: payment-account names (what a counterparty pays
-- to/from — stored in dedicated columns: buyer_payment_name, payer_name,
-- receiving_name/receiving_accounts), admin panels, disputes, and KYC all keep
-- users.full_name. The nickname is purely how OTHER traders see you in the market.
--
-- Policy (decided with the operator):
--   • KYC-VERIFIED ONLY may set a nickname (a nickname => a real, verified person).
--   • UNIQUE, case-insensitive (no two traders share one).
--   • Reserved-word block: no impersonation of staff/roles or the platform brand.
--   • 3–20 chars, must start & end alphanumeric; letters/digits/space/. _ - only.

alter table public.users
  add column if not exists display_name text;

-- Case-insensitive uniqueness, only among rows that actually set a nickname.
create unique index if not exists users_display_name_lower_key
  on public.users (lower(display_name))
  where display_name is not null;

-- ── shared validation ────────────────────────────────────────────────────────
-- Returns NULL when p_norm is an acceptable nickname for p_user, else a short
-- machine reason ('short','long','chars','reserved','taken'). Uniqueness excludes
-- the caller's own row so re-saving the same name is a no-op, not a conflict.
-- SECURITY DEFINER: the uniqueness probe must see ALL users (bypassing RLS).
create or replace function public._display_name_reason(
  p_user uuid,
  p_norm text
) returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_squished text := lower(regexp_replace(coalesce(p_norm, ''), '[^a-zA-Z0-9]', '', 'g'));
begin
  if char_length(p_norm) < 3 then return 'short'; end if;
  if char_length(p_norm) > 20 then return 'long'; end if;
  -- Must start & end alphanumeric; the middle may add a space, dot, underscore
  -- or hyphen. Blocks leading/trailing punctuation and any other symbol.
  if p_norm !~ '^[A-Za-z0-9][A-Za-z0-9 ._-]*[A-Za-z0-9]$' then
    return 'chars';
  end if;
  -- Impersonation guard: staff/role words (as whole words) or the platform brand.
  if lower(p_norm) ~ '\y(admin|administrator|support|official|moderator|staff|helpdesk)\y'
     or v_squished ~ 'habeshap2p' then
    return 'reserved';
  end if;
  if exists (
    select 1 from public.users
    where lower(display_name) = lower(p_norm)
      and id <> p_user
  ) then
    return 'taken';
  end if;
  return null;
end;
$$;

-- Live availability/format check for the UI (read-only). Returns 'ok', 'empty',
-- or a reason from _display_name_reason.
create or replace function public.display_name_status(
  p_user uuid,
  p_name text
) returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_norm text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if v_norm = '' then return 'empty'; end if;
  return coalesce(public._display_name_reason(p_user, v_norm), 'ok');
end;
$$;

-- Setter: validate + persist. KYC-verified only. An empty name clears the
-- nickname (reverts the public display to the legal name). Raises a friendly
-- exception on any rejection so the server action can surface the message.
create or replace function public.set_display_name(
  p_user uuid,
  p_name text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_norm   text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_reason text;
  v_kyc    text;
begin
  -- Clearing is always allowed (reverts to the legal name).
  if v_norm = '' then
    update public.users set display_name = null where id = p_user;
    return null;
  end if;

  select kyc_status into v_kyc from public.users where id = p_user;
  if v_kyc is distinct from 'APPROVED' then
    raise exception 'Verify your identity before choosing a display name'
      using errcode = 'check_violation';
  end if;

  v_reason := public._display_name_reason(p_user, v_norm);
  if v_reason = 'short' then
    raise exception 'Display name must be at least 3 characters' using errcode = 'check_violation';
  elsif v_reason = 'long' then
    raise exception 'Display name must be 20 characters or fewer' using errcode = 'check_violation';
  elsif v_reason = 'chars' then
    raise exception 'Use letters, numbers, spaces and . _ - only (start and end with a letter or number)' using errcode = 'check_violation';
  elsif v_reason = 'reserved' then
    raise exception 'That name is not allowed' using errcode = 'check_violation';
  elsif v_reason = 'taken' then
    raise exception 'That name is already taken' using errcode = 'unique_violation';
  end if;

  update public.users set display_name = v_norm where id = p_user;
  return v_norm;
exception
  -- Race: another trader claimed the same name between the check and the write.
  when unique_violation then
    raise exception 'That name is already taken' using errcode = 'unique_violation';
end;
$$;

-- ── lock down execution ──────────────────────────────────────────────────────
-- These run as the definer (owner) and DO NOT check auth.uid() = p_user, so they
-- must NEVER be callable by clients directly (that would let one user rename
-- another). Only trusted server code holding the service role may call them; the
-- server action enforces p_user = the authenticated user's id.
revoke all on function public._display_name_reason(uuid, text) from public, anon, authenticated;
revoke all on function public.display_name_status(uuid, text) from public, anon, authenticated;
revoke all on function public.set_display_name(uuid, text) from public, anon, authenticated;
grant execute on function public._display_name_reason(uuid, text) to service_role;
grant execute on function public.display_name_status(uuid, text) to service_role;
grant execute on function public.set_display_name(uuid, text) to service_role;

-- ── expose the nickname on the public profile view ───────────────────────────
-- `create or replace view` can only APPEND columns, so display_name goes last.
-- It is a safe, intentionally-public column (no phone/email/device data).
create or replace view public.public_profiles as
  select id, reputation_score, completed_trades, completion_rate,
         avg_release_seconds, is_merchant, created_at,
         full_name,
         (kyc_status = 'APPROVED') as is_verified,
         last_seen_at,
         display_name
  from public.users
  where account_status = 'ACTIVE';
