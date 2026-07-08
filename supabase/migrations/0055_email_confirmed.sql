-- 0055 — expose whether an account confirmed its email (for admin moderation)
--
-- Email confirmation lives on auth.users.email_confirmed_at, which PostgREST
-- doesn't expose. This SECURITY DEFINER helper lets the admin account table show
-- accounts that registered but never verified their email (e.g. clicked no link)
-- as "Inactive". Read-only, scoped to the ids the admin table is already
-- rendering; service-role only.

create or replace function public.accounts_email_confirmed(p_ids uuid[])
returns table (id uuid, confirmed boolean)
language sql
security definer
set search_path = public, auth
as $$
  select u.id,
         (au.email_confirmed_at is not null
          or au.phone_confirmed_at is not null) as confirmed
    from public.users u
    join auth.users au on au.id = u.id
   where u.id = any (p_ids);
$$;

revoke all on function public.accounts_email_confirmed(uuid[]) from public;
grant execute on function public.accounts_email_confirmed(uuid[]) to service_role;
