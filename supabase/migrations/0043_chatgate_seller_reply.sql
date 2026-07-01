-- 0043 — chat-gate now requires the SELLER to have replied, not just the buyer
--
-- 0042 let the buyer mark paid once THEY had sent a message. But a message into
-- the void proves nothing — the seller could be offline/unresponsive, and the
-- buyer would still be able to send ETB. The gate now requires a message FROM THE
-- SELLER on the order: the seller has to actually engage before any money moves.
-- The buyer naturally messages first to prompt a reply, so this enforces genuine
-- two-way contact. Everything else about order_mark_paid (the fresh release
-- window from migration 0042) is unchanged.

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

  -- Chat-first: the SELLER must have replied in chat before any ETB moves, so a
  -- buyer can never pay an unresponsive/offline seller.
  if not exists (
    select 1 from public.messages m
    where m.order_id = p_order and m.sender_id = v_order.seller_id
  ) then
    raise exception 'wait for the seller to reply in chat before you mark this order paid';
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
