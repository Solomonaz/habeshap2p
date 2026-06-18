-- 0006 — enable Realtime on the ads order book
--
-- Lets the market page receive live INSERT/UPDATE/DELETE on ads so new and
-- changed listings appear without a refresh. Realtime still honours RLS, so
-- subscribers only receive rows they are allowed to read (ACTIVE ads, or their
-- own). Chat + order-status realtime are added in their own phases (4 / 3).

alter publication supabase_realtime add table public.ads;
