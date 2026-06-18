-- 0009 — Realtime on orders (Phase 4 counterparty notifications)
--
-- Lets each party receive live INSERT/UPDATE on orders they belong to, so the
-- advertiser is notified the instant a taker opens an order, and both sides see
-- state changes (PAID / RELEASED / CANCELLED) without a refresh.
--
-- Realtime enforces RLS for postgres_changes, and orders_select_party (0004)
-- restricts SELECT to buyer_id/seller_id = auth.uid(). So a subscriber only ever
-- receives rows for their own orders — no column filter is needed on the client.
alter publication supabase_realtime add table public.orders;
