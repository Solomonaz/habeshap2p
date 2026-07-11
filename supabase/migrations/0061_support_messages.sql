-- 0061 — trader ⇄ admin support messaging
--
-- A lightweight support channel: each trader has ONE ongoing conversation with the
-- support team (all admins share the inbox). A trader sends a message; every admin
-- is notified and any admin can reply; the reply notifies the trader. Rows are read
-- under RLS (a trader sees only their own thread; admins see all). All writes go
-- through the SECURITY DEFINER RPCs below — never the client directly — and each
-- one fires the existing notification so both sides get the bell + sound.

create table if not exists public.support_messages (
  id         uuid primary key default gen_random_uuid(),
  -- The trader the thread belongs to (NOT necessarily the author — an admin reply
  -- is stored on the same thread with from_admin = true).
  user_id    uuid not null references public.users (id) on delete cascade,
  from_admin boolean not null,
  -- Which admin wrote it (only set when from_admin), for the audit trail.
  admin_id   uuid references public.users (id),
  body       text not null
               check (length(btrim(body)) > 0 and length(body) <= 2000),
  -- When the RECIPIENT read it (null = unread). For a trader message the recipient
  -- is the admins; for an admin message it's the trader.
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists support_messages_thread_idx
  on public.support_messages (user_id, created_at);
-- Admin inbox "unread from traders" probe.
create index if not exists support_messages_admin_unread_idx
  on public.support_messages (created_at) where from_admin = false and read_at is null;

alter table public.support_messages enable row level security;
grant select on public.support_messages to authenticated;

-- A trader may READ only their own thread; an admin may read every thread. No
-- client INSERT/UPDATE — those go through the RPCs below.
drop policy if exists support_messages_select on public.support_messages;
create policy support_messages_select on public.support_messages
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin = true)
  );

-- Realtime (respects the policy above: a trader receives only their thread, admins
-- receive all threads for the live inbox).
alter publication supabase_realtime add table public.support_messages;

-- ── support_user_send: a trader posts to their own thread ────────────────────
create or replace function public.support_user_send(
  p_user uuid,
  p_body text
) returns public.support_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_row    public.support_messages%rowtype;
begin
  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'message is required';
  end if;

  -- A banned account can't open a support thread (frozen may — they might be
  -- appealing). Mirrors the account-standing guard used elsewhere.
  select account_status into v_status from public.users where id = p_user;
  if v_status = 'BANNED' then
    raise exception 'your account is banned';
  end if;

  insert into public.support_messages (user_id, from_admin, body)
    values (p_user, false, btrim(p_body))
    returning * into v_row;

  perform public.notify_admins(
    'support_message',
    'New support message',
    left(btrim(p_body), 140),
    '/admin/support/' || p_user::text
  );
  return v_row;
end;
$$;

-- ── support_admin_send: an admin replies on a trader's thread ────────────────
create or replace function public.support_admin_send(
  p_admin uuid,
  p_user  uuid,
  p_body  text
) returns public.support_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_row      public.support_messages%rowtype;
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can reply to support';
  end if;
  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'reply is required';
  end if;
  perform 1 from public.users where id = p_user;
  if not found then raise exception 'user % not found', p_user; end if;

  insert into public.support_messages (user_id, from_admin, admin_id, body)
    values (p_user, true, p_admin, btrim(p_body))
    returning * into v_row;

  perform public.notify(
    p_user,
    'support_reply',
    'Support replied',
    left(btrim(p_body), 140),
    '/support'
  );
  return v_row;
end;
$$;

-- ── mark-read helpers ────────────────────────────────────────────────────────
-- Trader opens their thread → mark the admin replies read.
create or replace function public.support_mark_read_user(p_user uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.support_messages
    set read_at = now()
    where user_id = p_user and from_admin = true and read_at is null;
$$;

-- Admin opens a trader's thread → mark that trader's messages read.
create or replace function public.support_mark_read_admin(p_admin uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_is_admin boolean;
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can read support threads';
  end if;
  update public.support_messages
    set read_at = now()
    where user_id = p_user and from_admin = false and read_at is null;
end;
$$;

-- ── admin_support_threads: the inbox — one row per trader with unread + last msg
create or replace function public.admin_support_threads()
returns table (
  user_id      uuid,
  full_name    text,
  public_id    text,
  last_body    text,
  last_from_admin boolean,
  last_at      timestamptz,
  unread       bigint
)
language sql
security definer
set search_path = public
as $$
  with agg as (
    select
      m.user_id,
      max(m.created_at) as last_at,
      count(*) filter (where m.from_admin = false and m.read_at is null) as unread
    from public.support_messages m
    group by m.user_id
  )
  select
    a.user_id,
    u.full_name,
    u.public_id,
    last_m.body,
    last_m.from_admin,
    a.last_at,
    a.unread
  from agg a
  join public.users u on u.id = a.user_id
  join lateral (
    select body, from_admin from public.support_messages m2
    where m2.user_id = a.user_id
    order by m2.created_at desc
    limit 1
  ) last_m on true
  order by a.last_at desc;
$$;

-- Total unread from traders, for the admin nav badge.
create or replace function public.admin_support_unread_count()
returns bigint
language sql
security definer
set search_path = public
as $$
  select count(*) from public.support_messages
    where from_admin = false and read_at is null;
$$;

-- ── grants: server (service_role) only, except the trader mark-read which the
--    session client may call for its own thread ───────────────────────────────
revoke all on function public.support_user_send(uuid, text) from public;
revoke all on function public.support_admin_send(uuid, uuid, text) from public;
revoke all on function public.support_mark_read_user(uuid) from public;
revoke all on function public.support_mark_read_admin(uuid, uuid) from public;
revoke all on function public.admin_support_threads() from public;
revoke all on function public.admin_support_unread_count() from public;

grant execute on function public.support_user_send(uuid, text) to service_role;
grant execute on function public.support_admin_send(uuid, uuid, text) to service_role;
grant execute on function public.support_mark_read_user(uuid) to service_role;
grant execute on function public.support_mark_read_admin(uuid, uuid) to service_role;
grant execute on function public.admin_support_threads() to service_role;
grant execute on function public.admin_support_unread_count() to service_role;
