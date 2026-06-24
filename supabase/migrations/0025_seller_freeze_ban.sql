-- 0025 — auto-freeze + temp-ban a seller who misses the release window (Phase 10)
--
-- Product rule (the user's explicit request): when a PAID order's release window
-- elapses and the seller still hasn't released, the seller is presumed to be
-- stalling/cheating. The system must, the instant the window passes:
--
--   1. FREEZE the seller's ENTIRE spendable wallet — all usdt_available PLUS any
--      merchant bond (usdt_bond) — into a new usdt_frozen bucket. Nothing of it
--      is withdrawable or tradeable. (The disputed order's escrow already sits in
--      usdt_locked and stays locked; we don't touch it here.)
--   2. TEMP-BAN the account (account_status = 'FROZEN') so they can neither trade
--      nor withdraw while a human reviews.
--   3. AUTO-OPEN a dispute (on the wronged buyer's behalf) and flip the order to
--      DISPUTED, so the existing admin dispute console drives the resolution.
--
-- An admin then rules ONE of two ways, through the existing dispute_resolve:
--   • FAVOUR_BUYER  → the cheat path: buyer is made whole (disputed escrow → buyer,
--     no fee), the seller's FROZEN funds are FORFEITED to the platform, and the
--     account is PERMANENTLY BANNED ('BANNED').
--   • FAVOUR_SELLER → the exoneration path (maybe the seller had a real problem):
--     the disputed escrow returns to the seller, the FROZEN funds are released back
--     to available, and the account is reinstated ('ACTIVE') for normal trading.
--
-- Conservation extends cleanly. The new buckets are user-owned (usdt_frozen) and
-- platform-owned (platform_account.usdt_forfeited); the invariant becomes:
--   sum(available + locked + bond + withdraw_locked + frozen)
--     + platform_account.usdt_fees + platform_account.usdt_forfeited   is invariant.
--
-- PG GOTCHA: enum values added with ALTER TYPE ... ADD VALUE cannot be *used* in
-- the same transaction. This migration runs in one transaction and the new
-- functions reference 'FREEZE'/'UNFREEZE'/'FORFEIT' literals, so we turn off body
-- validation. The literals are only evaluated at call time, never during the
-- migration, so this is safe.
set check_function_bodies = off;

-- ── new escrow bucket: frozen funds ──────────────────────────────────────────
alter table public.wallets
  add column if not exists usdt_frozen numeric(20, 6) not null default 0
    check (usdt_frozen >= 0);

-- ── platform forfeiture bucket (slashed funds the platform keeps) ────────────
alter table public.platform_account
  add column if not exists usdt_forfeited numeric(20, 6) not null default 0
    check (usdt_forfeited >= 0);

-- ── account standing on users ────────────────────────────────────────────────
--   ACTIVE  — normal.
--   FROZEN  — temp-banned, funds frozen, awaiting an admin ruling.
--   BANNED  — permanently banned (funds forfeited).
alter table public.users
  add column if not exists account_status text not null default 'ACTIVE'
    check (account_status in ('ACTIVE', 'FROZEN', 'BANNED'));
alter table public.users
  add column if not exists frozen_at timestamptz;
alter table public.users
  add column if not exists ban_reason text;

-- ── new ledger types for the freeze lifecycle ────────────────────────────────
alter type ledger_type add value if not exists 'FREEZE';
alter type ledger_type add value if not exists 'UNFREEZE';
alter type ledger_type add value if not exists 'FORFEIT';

-- ── protect the new account-standing columns from client writes ──────────────
-- Recreated guard: a user must never flip their own ban state / reputation /
-- privileges. Only the service role (server code) may change these columns.
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
       or new.is_admin            is distinct from old.is_admin
       or new.account_status      is distinct from old.account_status
       or new.frozen_at           is distinct from old.frozen_at
       or new.ban_reason          is distinct from old.ban_reason then
      raise exception 'Protected user columns can only be modified server-side';
    end if;
  end if;
  return new;
end;
$$;

-- ── order_freeze_seller: auto-trigger when a PAID order's window elapses ──────
-- Idempotent and safe for anyone to call (the UI countdown, the cron). It acts
-- ONLY on a PAID order that is genuinely past its deadline; anything else no-ops
-- and returns false. On a real hit it freezes the seller's whole spendable
-- wallet, temp-bans them, opens a dispute on the buyer's behalf, and flips the
-- order to DISPUTED. Returns true iff it froze/disputed this call.
create or replace function public.order_freeze_seller(p_order uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  public.orders%rowtype;
  v_status text;
  v_avail  numeric(20, 6);
  v_bond   numeric(20, 6);
  v_sweep  numeric(20, 6);
begin
  select * into v_order from public.orders where id = p_order for update;
  if not found then
    raise exception 'order % not found', p_order;
  end if;

  -- Only a PAID order whose release window has elapsed qualifies.
  if v_order.state <> 'PAID' or v_order.expires_at > now() then
    return false;
  end if;

  -- Freeze the seller's whole spendable wallet: available + bond -> frozen.
  -- (Other orders' escrow in usdt_locked is left untouched — it belongs to those
  -- specific trades and moves only when each settles.)
  select account_status into v_status
    from public.users where id = v_order.seller_id for update;
  select usdt_available, usdt_bond into v_avail, v_bond
    from public.wallets where user_id = v_order.seller_id for update;
  v_sweep := coalesce(v_avail, 0) + coalesce(v_bond, 0);

  -- Sweep funds only the first time (a second elapsed order finds nothing left).
  if coalesce(v_status, 'ACTIVE') = 'ACTIVE' and v_sweep > 0 then
    update public.wallets
      set usdt_available = 0,
          usdt_bond      = 0,
          usdt_frozen    = usdt_frozen + v_sweep
      where user_id = v_order.seller_id;
    insert into public.ledger_entries (user_id, order_id, type, amount_usdt)
      values (v_order.seller_id, p_order, 'FREEZE', v_sweep);
  end if;

  -- Temp-ban the account (only escalate from ACTIVE; never downgrade a BANNED).
  if coalesce(v_status, 'ACTIVE') = 'ACTIVE' then
    update public.users
      set account_status = 'FROZEN',
          frozen_at      = now(),
          ban_reason     = format('Auto: missed release window on order %s', p_order),
          is_merchant    = false   -- the bond is frozen; merchant standing pauses
      where id = v_order.seller_id;
  end if;

  -- Auto-open a dispute on the buyer's behalf and freeze the order. If one
  -- already exists (shouldn't for a PAID order) the unique constraint guards it.
  insert into public.disputes (order_id, opened_by, reason)
    values (
      p_order, v_order.buyer_id,
      'Auto-opened: the seller did not release within the payment window. Escrow frozen pending admin review.'
    )
    on conflict (order_id) do nothing;

  update public.orders set state = 'DISPUTED' where id = p_order;

  return true;
end;
$$;

revoke all on function public.order_freeze_seller(uuid) from public;
grant execute on function public.order_freeze_seller(uuid) to service_role;

-- ── dispute_resolve: recreated to settle a frozen seller's funds + ban ───────
-- Byte-for-byte the migration 0010 escrow logic, PLUS: if the order's seller is
-- currently FROZEN (i.e. this dispute came from an auto-freeze), the ruling also
-- disposes of the frozen funds and the account standing:
--   FAVOUR_BUYER  → forfeit all frozen funds to the platform + permanent BAN.
--   FAVOUR_SELLER → return all frozen funds to available + reinstate (ACTIVE).
-- A normal dispute (seller not frozen) behaves exactly as before.
create or replace function public.dispute_resolve(
  p_dispute    uuid,
  p_admin      uuid,
  p_resolution dispute_resolution
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispute  public.disputes%rowtype;
  v_order    public.orders%rowtype;
  v_is_admin boolean;
  v_status   text;
  v_frozen   numeric(20, 6);
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can resolve a dispute';
  end if;

  -- Lock the dispute, then the order it points at (consistent lock order).
  select * into v_dispute from public.disputes where id = p_dispute for update;
  if not found then raise exception 'dispute % not found', p_dispute; end if;
  if v_dispute.status = 'RESOLVED' then
    raise exception 'dispute % is already resolved', p_dispute;
  end if;

  select * into v_order from public.orders where id = v_dispute.order_id for update;
  if not found then raise exception 'order % not found', v_dispute.order_id; end if;
  if v_order.state <> 'DISPUTED' then
    raise exception 'order % is % — not in dispute', v_order.id, v_order.state;
  end if;

  if p_resolution = 'FAVOUR_BUYER' then
    -- Escrow leaves the seller's locked balance and the buyer is credited the
    -- FULL amount (no fee). Mirrors order_release's locking + ledger trail.
    perform 1 from public.wallets where user_id = v_order.seller_id for update;
    perform 1 from public.wallets where user_id = v_order.buyer_id  for update;

    update public.wallets
      set usdt_locked = usdt_locked - v_order.amount_usdt
      where user_id = v_order.seller_id;
    update public.wallets
      set usdt_available = usdt_available + v_order.amount_usdt
      where user_id = v_order.buyer_id;

    insert into public.ledger_entries (user_id, order_id, type, amount_usdt) values
      (v_order.seller_id, v_order.id, 'RELEASE', v_order.amount_usdt),
      (v_order.buyer_id,  v_order.id, 'RELEASE', v_order.amount_usdt);

    update public.orders
      set state = 'RELEASED', released_at = now()
      where id = v_order.id;

  elsif p_resolution = 'FAVOUR_SELLER' then
    -- Refund: the locked escrow returns to the seller (available), order voided.
    perform public.ledger_unlock(v_order.seller_id, v_order.amount_usdt, v_order.id);

    update public.orders
      set state = 'CANCELLED', cancelled_at = now()
      where id = v_order.id;

  else
    raise exception 'unknown resolution %', p_resolution;
  end if;

  -- Frozen-seller disposition. Only fires when this dispute came from an
  -- auto-freeze (the seller is still FROZEN). A normal dispute skips all of this.
  select account_status into v_status
    from public.users where id = v_order.seller_id for update;
  if coalesce(v_status, 'ACTIVE') = 'FROZEN' then
    select usdt_frozen into v_frozen
      from public.wallets where user_id = v_order.seller_id for update;
    v_frozen := coalesce(v_frozen, 0);

    if p_resolution = 'FAVOUR_BUYER' then
      -- Cheat confirmed: forfeit the frozen funds to the platform, permanent ban.
      if v_frozen > 0 then
        update public.wallets
          set usdt_frozen = 0
          where user_id = v_order.seller_id;
        update public.platform_account
          set usdt_forfeited = usdt_forfeited + v_frozen where id;
        insert into public.ledger_entries (user_id, order_id, type, amount_usdt)
          values (v_order.seller_id, v_order.id, 'FORFEIT', v_frozen);
      end if;
      update public.users
        set account_status = 'BANNED',
            ban_reason     = format('Permanently banned: failed to release order %s; funds forfeited by admin.', v_order.id)
        where id = v_order.seller_id;

    else  -- FAVOUR_SELLER: exonerate — return frozen funds, reinstate account.
      if v_frozen > 0 then
        update public.wallets
          set usdt_frozen    = 0,
              usdt_available = usdt_available + v_frozen
          where user_id = v_order.seller_id;
        insert into public.ledger_entries (user_id, order_id, type, amount_usdt)
          values (v_order.seller_id, v_order.id, 'UNFREEZE', v_frozen);
      end if;
      update public.users
        set account_status = 'ACTIVE',
            frozen_at      = null,
            ban_reason     = null
        where id = v_order.seller_id;
    end if;
  end if;

  -- Disputed trades are exceptional and deliberately do NOT bump reputation /
  -- completion stats for either party: a contested outcome should not reward
  -- either side.

  update public.disputes set
    status      = 'RESOLVED',
    resolution  = p_resolution,
    resolved_by = p_admin,
    resolved_at = now()
    where id = p_dispute;
end;
$$;

revoke all on function public.dispute_resolve(uuid, uuid, dispute_resolution) from public;
grant execute on function public.dispute_resolve(uuid, uuid, dispute_resolution) to service_role;

-- ── order_create: refuse to open an order for a non-ACTIVE party ─────────────
-- Byte-for-byte the migration 0022 body plus a standing check: a FROZEN/BANNED
-- user can neither take an ad nor have their ad taken. Everything else (trade
-- limits, parties, payment window, escrow lock) is unchanged.
create or replace function public.order_create(
  p_ad uuid,
  p_taker uuid,
  p_amount_usdt numeric,
  p_payment_method payment_method,
  p_buyer_payment_name text,
  p_ttl_minutes integer default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ad           public.ads%rowtype;
  v_buyer        uuid;
  v_seller       uuid;
  v_amount_etb   numeric(20, 2);
  v_payer_name   text;
  v_order        uuid;
  v_buyer_cap    numeric;
  v_seller_cap   numeric;
  v_ttl          integer;
  v_taker_status text;
  v_owner_status text;
begin
  if p_amount_usdt is null or p_amount_usdt <= 0 then
    raise exception 'order amount must be positive (got %)', p_amount_usdt;
  end if;

  select * into v_ad from public.ads where id = p_ad for update;
  if not found then
    raise exception 'ad % not found', p_ad;
  end if;
  if v_ad.status <> 'ACTIVE' then
    raise exception 'ad % is not active', p_ad;
  end if;
  if v_ad.user_id = p_taker then
    raise exception 'cannot take your own ad';
  end if;
  if not (p_payment_method = any (v_ad.payment_methods)) then
    raise exception 'payment method % not offered on this ad', p_payment_method;
  end if;

  -- Account-standing guard: neither party may be frozen or banned.
  select account_status into v_taker_status from public.users where id = p_taker;
  if coalesce(v_taker_status, 'ACTIVE') <> 'ACTIVE' then
    raise exception 'your account is % — you cannot trade', v_taker_status;
  end if;
  select account_status into v_owner_status from public.users where id = v_ad.user_id;
  if coalesce(v_owner_status, 'ACTIVE') <> 'ACTIVE' then
    raise exception 'the advertiser''s account is not active — this ad cannot be taken';
  end if;

  -- Parties depend on which side the advertiser is on.
  if v_ad.side = 'SELL' then          -- advertiser sells USDT -> taker buys
    v_seller := v_ad.user_id;
    v_buyer  := p_taker;
    v_payer_name := p_buyer_payment_name;     -- taker (buyer) supplies it
  else                                 -- BUY ad: advertiser buys -> taker sells
    v_seller := p_taker;
    v_buyer  := v_ad.user_id;
    v_payer_name := v_ad.payer_name;          -- advertiser (buyer) supplied it
  end if;

  if v_payer_name is null or length(btrim(v_payer_name)) = 0 then
    raise exception 'buyer payment name is required';
  end if;

  -- Trade-limit guard (rule #5). Both parties must be within their per-order cap;
  -- a null cap means a bonded merchant with no limit.
  v_buyer_cap  := public._trade_limit_usdt(v_buyer);
  v_seller_cap := public._trade_limit_usdt(v_seller);
  if v_buyer_cap is not null and p_amount_usdt > v_buyer_cap then
    raise exception 'order amount % USDT exceeds the buyer trade limit of % USDT (post a merchant bond to lift it)',
      p_amount_usdt, v_buyer_cap;
  end if;
  if v_seller_cap is not null and p_amount_usdt > v_seller_cap then
    raise exception 'order amount % USDT exceeds the seller trade limit of % USDT (post a merchant bond to lift it)',
      p_amount_usdt, v_seller_cap;
  end if;

  v_amount_etb := round(p_amount_usdt * v_ad.rate_etb, 2);
  if v_amount_etb < v_ad.min_etb or v_amount_etb > v_ad.max_etb then
    raise exception 'order value % ETB is outside ad limits %–% ETB',
      v_amount_etb, v_ad.min_etb, v_ad.max_etb;
  end if;

  -- Resolve the payment window: an explicit p_ttl_minutes wins; otherwise read
  -- the admin-configured order_ttl_minutes (fail safe to 15 if no row).
  if p_ttl_minutes is not null then
    v_ttl := p_ttl_minutes;
  else
    select order_ttl_minutes into v_ttl from public.platform_settings where id;
    v_ttl := coalesce(v_ttl, 15);
  end if;

  -- Insert the order first so the lock's ledger entry carries the order id.
  insert into public.orders (
    ad_id, buyer_id, seller_id, amount_usdt, rate_etb, amount_etb,
    payment_method, buyer_payment_name, expires_at
  ) values (
    p_ad, v_buyer, v_seller, p_amount_usdt, v_ad.rate_etb, v_amount_etb,
    p_payment_method, btrim(v_payer_name),
    now() + make_interval(mins => greatest(v_ttl, 1))
  )
  returning id into v_order;

  -- Lock the seller's escrow (available -> locked) against the new order.
  perform public.ledger_lock(v_seller, p_amount_usdt, v_order);

  return v_order;
end;
$$;

grant execute on function public.order_create(uuid, uuid, numeric, payment_method, text, integer) to service_role;

-- ── platform_stats: recreated to count the frozen + forfeited buckets ────────
-- Conservation now includes user-owned usdt_frozen and platform-owned
-- usdt_forfeited so the reconciliation figure stays exact.
create or replace function public.platform_stats()
returns jsonb
language sql
security definer
set search_path = public
as $$
  with bal as (
    select
      coalesce(sum(usdt_available), 0)       as available,
      coalesce(sum(usdt_locked), 0)          as locked,
      coalesce(sum(usdt_bond), 0)            as bond,
      coalesce(sum(usdt_withdraw_locked), 0) as withdraw_locked,
      coalesce(sum(usdt_frozen), 0)          as frozen
    from public.wallets
  ),
  acct as (
    select coalesce(usdt_fees, 0) as fees, coalesce(usdt_forfeited, 0) as forfeited
    from public.platform_account where id = true
  )
  select jsonb_build_object(
    'available',       (select available::text from bal),
    'locked',          (select locked::text from bal),
    'bond',            (select bond::text from bal),
    'withdraw_locked', (select withdraw_locked::text from bal),
    'frozen',          (select frozen::text from bal),
    'platform_fees',   (select coalesce((select fees from acct), 0)::text),
    'platform_forfeited', (select coalesce((select forfeited from acct), 0)::text),
    'liabilities',
      (select (available + locked + bond + withdraw_locked + frozen)::text from bal),
    'total_supply',
      (select (available + locked + bond + withdraw_locked + frozen
               + coalesce((select fees from acct), 0)
               + coalesce((select forfeited from acct), 0))::text from bal),
    'user_count',           (select count(*) from public.users),
    'merchant_count',       (select count(*) from public.users where is_merchant),
    'frozen_account_count', (select count(*) from public.users where account_status = 'FROZEN'),
    'banned_account_count', (select count(*) from public.users where account_status = 'BANNED'),
    'active_ad_count',      (select count(*) from public.ads where status = 'ACTIVE'),
    'open_order_count',
      (select count(*) from public.orders where state in ('CREATED','PAID','DISPUTED')),
    'open_dispute_count',   (select count(*) from public.disputes where status <> 'RESOLVED'),
    'pending_withdrawal_count',
      (select count(*) from public.withdrawals where status = 'PENDING_APPROVAL')
  );
$$;

revoke all on function public.platform_stats() from public;
grant execute on function public.platform_stats() to service_role;
