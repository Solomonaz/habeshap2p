-- 0004 — Row Level Security
--
-- Model: clients connect as the `authenticated` (or `anon`) role and every
-- query is gated by the policies below. Trusted server code uses the
-- service-role key, which bypasses RLS entirely — that is how escrow money-moves,
-- cron jobs, and admin actions cross user boundaries. So the rule of thumb is:
--   * anything a user may see/do on their OWN data → an explicit policy here
--   * anything that crosses users or mutates balances/state → service role only
--
-- Privileges: grant the table operations that have a matching policy; withhold
-- the rest so "no policy" is reinforced by "no privilege".

-- ── users ────────────────────────────────────────────────────────────────────
alter table public.users enable row level security;

grant select, insert, update on public.users to authenticated;

create policy users_select_own on public.users
  for select to authenticated
  using (id = auth.uid());

create policy users_insert_own on public.users
  for insert to authenticated
  with check (id = auth.uid());

-- Self-edits allowed; protected columns are blocked by the trigger in 0002.
create policy users_update_own on public.users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Counterparty reputation is read through this view (safe columns only).
grant select on public.public_profiles to authenticated;

-- ── wallets ──────────────────────────────────────────────────────────────────
alter table public.wallets enable row level security;

grant select on public.wallets to authenticated;
-- No insert/update/delete: balances change only via server-side escrow RPCs.

create policy wallets_select_own on public.wallets
  for select to authenticated
  using (user_id = auth.uid());

-- ── ads ──────────────────────────────────────────────────────────────────────
alter table public.ads enable row level security;

grant select, insert, update, delete on public.ads to authenticated;

-- Active ads are visible to all signed-in users; owners also see their own
-- paused/closed ads.
create policy ads_select_active_or_own on public.ads
  for select to authenticated
  using (status = 'ACTIVE' or user_id = auth.uid());

create policy ads_insert_own on public.ads
  for insert to authenticated
  with check (user_id = auth.uid());

create policy ads_update_own on public.ads
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy ads_delete_own on public.ads
  for delete to authenticated
  using (user_id = auth.uid());

-- ── orders ───────────────────────────────────────────────────────────────────
alter table public.orders enable row level security;

grant select on public.orders to authenticated;
-- No client insert/update: opening an order locks USDT and every transition
-- (PAID, RELEASED, CANCELLED, DISPUTED) runs through a transactional server RPC.

create policy orders_select_party on public.orders
  for select to authenticated
  using (buyer_id = auth.uid() or seller_id = auth.uid());

-- ── messages ─────────────────────────────────────────────────────────────────
alter table public.messages enable row level security;

grant select, insert on public.messages to authenticated;
-- No update/delete: chat + proof are immutable evidence.

create policy messages_select_party on public.messages
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = messages.order_id
        and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
    )
  );

create policy messages_insert_party on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = messages.order_id
        and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
    )
  );

-- ── disputes ─────────────────────────────────────────────────────────────────
alter table public.disputes enable row level security;

grant select, insert on public.disputes to authenticated;
-- No client update: resolution is an admin action via the service role.

create policy disputes_select_party on public.disputes
  for select to authenticated
  using (
    opened_by = auth.uid()
    or exists (
      select 1 from public.orders o
      where o.id = disputes.order_id
        and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
    )
  );

create policy disputes_insert_party on public.disputes
  for insert to authenticated
  with check (
    opened_by = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = disputes.order_id
        and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
    )
  );

-- ── ledger_entries ───────────────────────────────────────────────────────────
alter table public.ledger_entries enable row level security;

grant select on public.ledger_entries to authenticated;
-- Append-only and written only by server-side escrow RPCs.

create policy ledger_select_own on public.ledger_entries
  for select to authenticated
  using (user_id = auth.uid());

-- ── chain_txs ────────────────────────────────────────────────────────────────
alter table public.chain_txs enable row level security;

grant select on public.chain_txs to authenticated;
-- Written only by server-side deposit polling / withdrawal signing.

create policy chain_txs_select_own on public.chain_txs
  for select to authenticated
  using (user_id = auth.uid());
