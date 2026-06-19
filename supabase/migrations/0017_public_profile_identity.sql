-- 0017 — expose the registered name + verification badge on public_profiles
--
-- Until now the order book and order screen showed a SYNTHETIC pseudonym
-- (src/lib/handle.ts) because public_profiles deliberately omitted any name.
-- The product decision is to show the real registered name (users.full_name,
-- captured at signup) so counterparties see who they're trading with, and to
-- surface a "verified" badge for accounts that cleared KYC.
--
-- PRIVACY NOTE: this publishes each trader's self-entered full name to any
-- authenticated user browsing the market. That is the intended behaviour here,
-- but it is a real exposure — the previous design was pseudonymous on purpose.

-- ── backfill full_name for existing accounts ─────────────────────────────────
-- Accounts created before name-capture (or whose signup metadata was missing)
-- have a null users.full_name, so the UI would fall back to the pseudonym.
-- Backfill from the most authoritative source available: the legal name on the
-- latest APPROVED KYC submission (admin-reviewed), then the signup metadata.
update public.users u
set full_name = coalesce(
  (
    select nullif(btrim(k.full_name), '')
    from public.kyc_submissions k
    where k.user_id = u.id and k.status = 'APPROVED'
    order by k.created_at desc
    limit 1
  ),
  nullif(btrim(au.raw_user_meta_data ->> 'full_name'), '')
)
from auth.users au
where au.id = u.id
  and (u.full_name is null or btrim(u.full_name) = '');

-- ── keep the displayed name pinned to the verified legal name ────────────────
-- When an admin approves a submission, mirror that exact name onto the user so
-- the public name always matches what was actually reviewed (and can't later be
-- silently changed away from the verified identity).
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

  update public.users
    set kyc_status = 'APPROVED',
        full_name = coalesce(nullif(btrim(v_sub.full_name), ''), full_name)
    where id = v_sub.user_id;
end;
$$;

-- ── recreate the view with name + verification flag ──────────────────────────
-- `create or replace view` can only APPEND columns (same names/types/order for
-- the existing ones), so full_name and is_verified go at the end.
create or replace view public.public_profiles as
  select id, reputation_score, completed_trades, completion_rate,
         avg_release_seconds, is_merchant, created_at,
         full_name,
         (kyc_status = 'APPROVED') as is_verified
  from public.users;

-- The view inherits the grant from 0004 (select to authenticated); no re-grant
-- needed for `create or replace`. full_name/is_verified are safe, non-sensitive
-- columns (no phone, email, or device fingerprint).
