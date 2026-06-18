-- 0002 — core tables: users, wallets, ads, orders (+ supporting triggers)

-- ── users ───────────────────────────────────────────────────────────────────
-- Profile row, 1:1 with auth.users. Reputation columns are maintained
-- server-side only (guarded by a trigger below); clients cannot edit them.
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  phone text,
  device_fingerprint text,
  reputation_score numeric(6, 2) not null default 0,
  completed_trades integer not null default 0 check (completed_trades >= 0),
  completion_rate numeric(5, 2) not null default 0
    check (completion_rate between 0 and 100),
  avg_release_seconds integer not null default 0 check (avg_release_seconds >= 0),
  is_merchant boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── wallets ──────────────────────────────────────────────────────────────────
-- Internal USDT ledger balances per user. Non-negative is enforced at the DB
-- level so a buggy money-move can never drive a balance below zero.
create table public.wallets (
  user_id uuid primary key references public.users (id) on delete cascade,
  usdt_available numeric(20, 6) not null default 0 check (usdt_available >= 0),
  usdt_locked numeric(20, 6) not null default 0 check (usdt_locked >= 0),
  deposit_address text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── ads ──────────────────────────────────────────────────────────────────────
create table public.ads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  side ad_side not null,
  rate_etb numeric(20, 4) not null check (rate_etb > 0),
  min_etb numeric(20, 2) not null check (min_etb >= 0),
  max_etb numeric(20, 2) not null check (max_etb >= 0),
  payment_methods payment_method[] not null
    check (array_length(payment_methods, 1) >= 1),
  status ad_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  constraint ads_min_le_max check (min_etb <= max_etb)
);
create index ads_book_idx on public.ads (side, status, rate_etb);

-- ── orders ───────────────────────────────────────────────────────────────────
-- The escrow lock lives in wallets.usdt_locked; this row tracks the lifecycle.
-- State transitions are performed only by server-side code (service role) via
-- transactional RPCs added in Phase 3 — never written directly by clients.
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references public.ads (id),
  buyer_id uuid not null references public.users (id),
  seller_id uuid not null references public.users (id),
  amount_usdt numeric(20, 6) not null check (amount_usdt > 0),
  rate_etb numeric(20, 4) not null check (rate_etb > 0),
  amount_etb numeric(20, 2) not null check (amount_etb > 0),
  fee_usdt numeric(20, 6) not null default 0 check (fee_usdt >= 0),
  state order_state not null default 'CREATED',
  payment_method payment_method not null,
  -- Real-name payment matching (spec rule #2): the name the buyer will pay from.
  buyer_payment_name text not null check (length(btrim(buyer_payment_name)) > 0),
  paid_at timestamptz,
  released_at timestamptz,
  cancelled_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint orders_distinct_parties check (buyer_id <> seller_id)
);
create index orders_buyer_idx on public.orders (buyer_id, state);
create index orders_seller_idx on public.orders (seller_id, state);
-- Cron auto-cancel scans for unpaid orders past their deadline.
create index orders_expiry_idx on public.orders (state, expires_at);

-- ── updated_at maintenance for wallets ───────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger wallets_touch_updated_at
  before update on public.wallets
  for each row execute function public.touch_updated_at();

-- ── protect server-maintained columns on users ───────────────────────────────
-- Even with an UPDATE RLS policy on their own row, a user must not be able to
-- inflate their own reputation or grant themselves admin/merchant. Only the
-- service role (server code) may change these columns.
create or replace function public.guard_users_protected_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    if new.reputation_score   is distinct from old.reputation_score
       or new.completed_trades    is distinct from old.completed_trades
       or new.completion_rate     is distinct from old.completion_rate
       or new.avg_release_seconds is distinct from old.avg_release_seconds
       or new.is_merchant         is distinct from old.is_merchant
       or new.is_admin            is distinct from old.is_admin then
      raise exception 'Protected user columns can only be modified server-side';
    end if;
  end if;
  return new;
end;
$$;

create trigger users_guard_protected_columns
  before update on public.users
  for each row execute function public.guard_users_protected_columns();

-- ── auto-provision profile + wallet on signup ────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, phone)
    values (new.id, new.phone)
    on conflict (id) do nothing;
  insert into public.wallets (user_id)
    values (new.id)
    on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
