-- 0026 — cron sweep that auto-freezes sellers of overdue PAID orders
--
-- order_freeze_seller (migration 0025) fires from the order page the instant a
-- PAID order's release window elapses. But if NOBODY opens that page, the freeze
-- would never happen. This sweep is the backstop, mirroring order_expire_unpaid
-- for the CREATED case: it walks every PAID order past its deadline and freezes
-- each seller (whole wallet frozen, temp-ban, auto-dispute), so the penalty is
-- guaranteed even with no viewer. Idempotent — re-running skips already-handled
-- orders because order_freeze_seller only acts on a still-PAID overdue order.
create or replace function public.order_freeze_overdue()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_count integer := 0;
begin
  for v_id in
    select id from public.orders
    where state = 'PAID' and expires_at <= now()
    order by expires_at
    for update skip locked
  loop
    if public.order_freeze_seller(v_id) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.order_freeze_overdue() from public;
grant execute on function public.order_freeze_overdue() to service_role;
