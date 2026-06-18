-- 0008 — Phase 4: in-trade chat realtime + payment-proof storage
--
-- The `messages` table and its RLS policies already exist (0003 / 0004). This
-- migration adds the two things Phase 4 needs on top:
--   1. Realtime delivery of new messages to the two order parties.
--   2. A PRIVATE storage bucket for payment-proof images, locked down so only
--      the buyer and seller of an order can read/write that order's proofs.

-- ── 1. Realtime on messages ──────────────────────────────────────────────────
-- Realtime still enforces RLS, so a subscriber only receives message rows for
-- orders they are a party to (policy messages_select_party in 0004).
alter publication supabase_realtime add table public.messages;

-- ── 2. Payment-proof storage bucket ──────────────────────────────────────────
-- Bank-transfer screenshots are sensitive, so the bucket is PRIVATE: objects are
-- never publicly readable; the app fetches them via short-lived signed URLs that
-- only succeed for users the policies below admit.
--
-- Object key convention: `<order_id>/<random>.<ext>`. The first path segment is
-- the order id, which the policies use to check membership. A client therefore
-- cannot read or write proofs for an order it is not party to, even though all
-- objects share one bucket.
insert into storage.buckets (id, name, public)
  values ('trade-proofs', 'trade-proofs', false)
  on conflict (id) do nothing;

-- Helper: is the current user a party to the order named by the object's first
-- path segment? `storage.foldername(name)` returns the path folders as text[].
create policy "trade_proofs_read_party"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'trade-proofs'
    and exists (
      select 1 from public.orders o
      where o.id = ((storage.foldername(name))[1])::uuid
        and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
    )
  );

create policy "trade_proofs_write_party"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'trade-proofs'
    and owner = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = ((storage.foldername(name))[1])::uuid
        and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
    )
  );

-- No update/delete policies: proofs are immutable evidence, mirroring messages.
