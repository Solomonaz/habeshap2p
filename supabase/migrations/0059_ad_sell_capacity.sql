-- 0059 — live sellable capacity for SELL ads (balance-aware limits)
--
-- A SELL ad advertises a max order in ETB, but every order taken against it locks
-- the seller's USDT in escrow. As the seller trades (or withdraws/transfers), their
-- balance falls while the ad's configured max stays put — so a buyer can see a
-- 75,000 ETB max against a seller who holds 0.16 USDT and can't fund it. Orders like
-- that only fail later at escrow time, wasting the buyer's effort.
--
-- This exposes each SELL ad's REAL capacity, derived from the seller's current
-- available balance, without leaking the raw wallet figure to buyers beyond the
-- ad's own liquidity (standard P2P "Available X USDT"):
--   effective_max_etb = least(configured max, floor(available × rate to 2dp))
--   fundable          = the seller can cover at least the ad's MINIMUM order
--
-- SECURITY DEFINER because a buyer can't read another user's wallet under RLS; the
-- function returns only per-ad capacity for the ad ids asked about. BUY ads are not
-- included — their limits aren't bounded by the advertiser's USDT (they're buying).

create or replace function public.ad_sell_capacity(p_ids uuid[])
returns table (
  ad_id             uuid,
  available_usdt    text,
  effective_max_etb text,
  fundable          boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    a.id,
    w.usdt_available::text,
    least(a.max_etb, trunc(w.usdt_available * a.rate_etb, 2))::text,
    (w.usdt_available * a.rate_etb) >= a.min_etb
  from public.ads a
  join public.wallets w on w.user_id = a.user_id
  where a.id = any (p_ids)
    and a.side = 'SELL';
$$;

revoke all on function public.ad_sell_capacity(uuid[]) from public;
grant execute on function public.ad_sell_capacity(uuid[]) to authenticated, service_role;
