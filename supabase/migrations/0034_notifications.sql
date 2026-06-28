-- 0034 — in-app notifications (realtime notification center for users + admins)
--
-- A persistent per-user feed surfaced as a bell with an unread count and history.
-- Every notable event (orders, deposits, withdrawals, disputes, KYC, account
-- moderation) writes a row here for the affected user(s); admin-facing events
-- write a row for each admin. The browser subscribes over Supabase Realtime and
-- renders them live. Rows are read under RLS (own only); writes go through the
-- SECURITY DEFINER helpers / service role — never the client directly.

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  type       text not null,                       -- machine event key, drives the icon
  title      text not null,
  body       text,
  href       text,                                -- where clicking it navigates
  audience   text not null default 'user'
               check (audience in ('user', 'admin')),
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
grant select on public.notifications to authenticated;

-- A user may READ only their own notifications. No client insert/update — those
-- go through the RPCs below (mark read) or the service role (creating them).
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

-- Realtime delivery (respects the RLS policy above, so a user only ever receives
-- their own rows).
alter publication supabase_realtime add table public.notifications;

-- ── notify: create one notification (SECURITY DEFINER so SQL functions + the
-- service role can call it; never granted to clients) ───────────────────────
create or replace function public.notify(
  p_user     uuid,
  p_type     text,
  p_title    text,
  p_body     text default null,
  p_href     text default null,
  p_audience text default 'user'
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, type, title, body, href, audience)
    values (p_user, p_type, p_title, nullif(btrim(p_body), ''), nullif(btrim(p_href), ''), coalesce(p_audience, 'user'));
$$;

-- ── notify_admins: fan a notification out to every admin ─────────────────────
create or replace function public.notify_admins(
  p_type  text,
  p_title text,
  p_body  text default null,
  p_href  text default null
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, type, title, body, href, audience)
    select id, p_type, p_title, nullif(btrim(p_body), ''), nullif(btrim(p_href), ''), 'admin'
      from public.users where is_admin = true;
$$;

revoke all on function public.notify(uuid, text, text, text, text, text) from public;
grant execute on function public.notify(uuid, text, text, text, text, text) to service_role;
revoke all on function public.notify_admins(text, text, text, text) from public;
grant execute on function public.notify_admins(text, text, text, text) to service_role;

-- ── mark_notifications_read: caller marks their own rows read ────────────────
-- p_ids null → mark ALL of the caller's unread as read; else just those ids
-- (still scoped to the caller, so you can't touch someone else's).
create or replace function public.mark_notifications_read(
  p_ids uuid[] default null
) returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications
    set read_at = now()
    where user_id = auth.uid()
      and read_at is null
      and (p_ids is null or id = any(p_ids));
$$;

revoke all on function public.mark_notifications_read(uuid[]) from public;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
