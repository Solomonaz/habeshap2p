-- 0056 — admin account listing: exclude admins + filter by inactive (email-unconfirmed)
--
-- The admin account table needs to (a) never show admin accounts and (b) filter
-- to accounts that registered but never confirmed their email/phone ("Inactive").
-- Both need a join to auth.users (for email_confirmed_at) plus paging, so it's one
-- SECURITY DEFINER function. Returns the page rows plus a windowed total for the
-- pager. Service-role only; the caller is already an admin.

create or replace function public.admin_list_accounts(
  p_query         text    default null,
  p_only_inactive boolean default false,
  p_limit         integer default 20,
  p_offset        integer default 0
)
returns table (
  id              uuid,
  full_name       text,
  email           text,
  public_id       text,
  account_status  text,
  ban_reason      text,
  kyc_status      text,
  email_confirmed boolean,
  created_at      timestamptz,
  total           bigint
)
language sql
security definer
set search_path = public, auth
as $$
  with base as (
    select u.id, u.full_name, u.email, u.public_id,
           u.account_status, u.ban_reason, u.kyc_status::text as kyc_status,
           (au.email_confirmed_at is not null
            or au.phone_confirmed_at is not null) as email_confirmed,
           u.created_at
      from public.users u
      join auth.users au on au.id = u.id
     where coalesce(u.is_admin, false) = false          -- never list admins
       and (
         p_query is null or length(btrim(p_query)) < 2
         or u.email     ilike '%' || btrim(p_query) || '%'
         or u.full_name ilike '%' || btrim(p_query) || '%'
         or u.public_id = btrim(p_query)
       )
  ),
  filtered as (
    select * from base
     where (not coalesce(p_only_inactive, false)) or email_confirmed = false
  )
  select f.id, f.full_name, f.email, f.public_id, f.account_status,
         f.ban_reason, f.kyc_status, f.email_confirmed, f.created_at,
         count(*) over () as total
    from filtered f
   order by f.created_at desc
   limit  greatest(coalesce(p_limit, 20), 1)
   offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.admin_list_accounts(text, boolean, integer, integer) from public;
grant execute on function public.admin_list_accounts(text, boolean, integer, integer) to service_role;
