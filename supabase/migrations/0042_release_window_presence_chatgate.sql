-- 0042 — three trade-safety improvements
--
-- (1) FRESH SELLER RELEASE WINDOW. Until now a PAID order kept the SAME deadline
--     (orders.expires_at) as the unpaid payment window. So if a buyer marked paid
--     near the end of the 15-minute window, the seller had only the leftover —
--     sometimes seconds — before order_freeze_seller swept their whole wallet and
--     temp-banned them. order_mark_paid now RESETS expires_at to a fresh,
--     admin-configurable release window (release_window_minutes, default 30) so
--     the seller always gets the same fair amount of time to confirm + release,
--     no matter how late in the payment window the buyer paid.
--
-- (2) CHAT-FIRST. A buyer can no longer mark an order paid until they have sent
--     at least one chat message on it. This forces buyer↔seller contact before
--     any ETB moves (catch an unresponsive seller, agree details, leave a trail).
--
-- (3) PRESENCE. users.last_seen_at + a touch_presence() heartbeat let the UI show
--     whether the counterparty is online, so a buyer can see a seller is around
--     before sending money. Exposed (read-only) through the public_profiles view.

-- ── (1) release window setting ───────────────────────────────────────────────
alter table public.platform_settings
  add column if not exists release_window_minutes integer not null default 30
    check (release_window_minutes >= 1);

create or replace function public.set_release_window(
  p_admin   uuid,
  p_minutes integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can change the release window';
  end if;
  if p_minutes is null or p_minutes < 1 then
    raise exception 'release window must be at least 1 minute (got %)', p_minutes;
  end if;

  insert into public.platform_settings (id, release_window_minutes, updated_by, updated_at)
    values (true, p_minutes, p_admin, now())
    on conflict (id) do update
      set release_window_minutes = excluded.release_window_minutes,
          updated_by             = excluded.updated_by,
          updated_at             = excluded.updated_at;
end;
$$;

revoke all on function public.set_release_window(uuid, integer) from public;
grant execute on function public.set_release_window(uuid, integer) to service_role;

-- ── (3) presence column + heartbeat ──────────────────────────────────────────
alter table public.users
  add column if not exists last_seen_at timestamptz;

-- Stamp the caller's presence. SECURITY DEFINER so it can write the one column
-- without opening the users table to client writes. The server action passes the
-- AUTHENTICATED user's id; it only ever touches last_seen_at.
create or replace function public.touch_presence(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users set last_seen_at = now() where id = p_user;
end;
$$;

revoke all on function public.touch_presence(uuid) from public;
grant execute on function public.touch_presence(uuid) to service_role;

-- Expose last_seen_at through the public profile view (read-only, non-sensitive —
-- just an online/offline signal). `create or replace view` may only APPEND a
-- column, so last_seen_at goes last.
create or replace view public.public_profiles as
  select id, reputation_score, completed_trades, completion_rate,
         avg_release_seconds, is_merchant, created_at,
         full_name,
         (kyc_status = 'APPROVED') as is_verified,
         last_seen_at
  from public.users;

-- ── (1)+(2) order_mark_paid: chat-gate + fresh release window ─────────────────
-- Byte-for-byte the migration 0023 body plus two changes: it refuses until the
-- buyer has chatted, and on success it stamps a FRESH release deadline instead of
-- leaving the leftover payment window.
create or replace function public.order_mark_paid(
  p_order uuid,
  p_actor uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  public.orders%rowtype;
  v_window integer;
begin
  select * into v_order from public.orders where id = p_order for update;
  if not found then raise exception 'order % not found', p_order; end if;
  if v_order.buyer_id <> p_actor then
    raise exception 'only the buyer can mark an order paid';
  end if;
  if v_order.state <> 'CREATED' then
    raise exception 'order % is % — cannot mark paid', p_order, v_order.state;
  end if;
  if v_order.expires_at <= now() then
    raise exception 'order % payment window has elapsed — cannot mark paid', p_order;
  end if;

  -- Chat-first: the buyer must have messaged the seller before any ETB moves.
  if not exists (
    select 1 from public.messages m
    where m.order_id = p_order and m.sender_id = v_order.buyer_id
  ) then
    raise exception 'message the seller in chat before you mark this order paid';
  end if;

  -- Fresh release window: the seller gets release_window_minutes from NOW to
  -- confirm + release, independent of how much of the payment window remained.
  select release_window_minutes into v_window
    from public.platform_settings where id;
  v_window := coalesce(v_window, 30);

  update public.orders
    set state = 'PAID',
        paid_at = now(),
        expires_at = now() + make_interval(mins => greatest(v_window, 1))
    where id = p_order;
end;
$$;

revoke all on function public.order_mark_paid(uuid, uuid) from public;
grant execute on function public.order_mark_paid(uuid, uuid) to service_role;
