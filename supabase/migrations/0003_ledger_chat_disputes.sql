-- 0003 — messages, disputes, ledger_entries, chain_txs

-- ── messages ─────────────────────────────────────────────────────────────────
-- In-trade chat + payment proof. Immutable: no UPDATE/DELETE is ever granted
-- (enforced by the absence of those RLS policies) so disputes have clean evidence.
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  sender_id uuid not null references public.users (id),
  body text,
  image_url text,
  created_at timestamptz not null default now(),
  -- a message must carry text or an image (or both)
  constraint messages_has_content check (body is not null or image_url is not null)
);
create index messages_order_idx on public.messages (order_id, created_at);

-- ── disputes ─────────────────────────────────────────────────────────────────
create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  opened_by uuid not null references public.users (id),
  reason text not null check (length(btrim(reason)) > 0),
  status dispute_status not null default 'OPEN',
  resolution dispute_resolution,
  resolved_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  -- at most one dispute per order
  constraint disputes_one_per_order unique (order_id),
  -- a resolved dispute must record how and by whom
  constraint disputes_resolution_complete check (
    status <> 'RESOLVED'
    or (resolution is not null and resolved_by is not null and resolved_at is not null)
  )
);
create index disputes_status_idx on public.disputes (status);

-- ── ledger_entries ───────────────────────────────────────────────────────────
-- Append-only money trail. No UPDATE/DELETE policy is granted to anyone; rows
-- are written only by server-side escrow RPCs. Every balance change in wallets
-- must have a corresponding entry here so the two can be reconciled.
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id),
  order_id uuid references public.orders (id),
  type ledger_type not null,
  amount_usdt numeric(20, 6) not null check (amount_usdt > 0),
  created_at timestamptz not null default now()
);
create index ledger_user_idx on public.ledger_entries (user_id, created_at);
create index ledger_order_idx on public.ledger_entries (order_id);

-- ── chain_txs ────────────────────────────────────────────────────────────────
-- On-chain deposit/withdrawal tracking. tx_hash unique to dedupe deposit polling.
create table public.chain_txs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id),
  direction chain_direction not null,
  tx_hash text not null unique,
  amount_usdt numeric(20, 6) not null check (amount_usdt > 0),
  confirmed boolean not null default false,
  created_at timestamptz not null default now()
);
create index chain_txs_user_idx on public.chain_txs (user_id, created_at);

-- ── public_profiles view ─────────────────────────────────────────────────────
-- Counterparty reputation needs to be visible across users, but phone and
-- device_fingerprint must not be. This view exposes only the safe columns and
-- is what the order book / order screen read for the other party's trust signals.
create view public.public_profiles as
  select id, reputation_score, completed_trades, completion_rate,
         avg_release_seconds, is_merchant, created_at
  from public.users;
