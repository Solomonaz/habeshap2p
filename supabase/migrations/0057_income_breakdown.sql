-- 0057 — platform income breakdown by source (for the Ops financial analysis)
--
-- All platform revenue lands in the ledger as FEE entries; referral rewards are
-- REFERRAL entries carved back out of that revenue. This aggregates them by
-- source so the Ops overview can show where income comes from. Categories keyed
-- off how each fee is written:
--   trade fee      — FEE with an order_id       (buyer + seller fees at release)
--   withdrawal fee — FEE, no order_id, no user  (kept by withdrawal_mark_sent)
--   transfer fee   — FEE, no order_id, has user (kept by internal_transfer)
--   referral payout— REFERRAL                    (paid to referrers; reduces net)
-- net = trade + withdrawal + transfer − referral  (== platform_account.usdt_fees)
--
-- Service-role only; the caller is already an admin.

create or replace function public.admin_income_breakdown()
returns table (
  trade_fees       numeric,
  withdrawal_fees  numeric,
  transfer_fees    numeric,
  referral_payouts numeric,
  net              numeric
)
language sql
security definer
set search_path = public
as $$
  with agg as (
    select
      coalesce(sum(amount_usdt) filter (
        where type = 'FEE' and order_id is not null), 0) as trade_fees,
      coalesce(sum(amount_usdt) filter (
        where type = 'FEE' and order_id is null and user_id is null), 0) as withdrawal_fees,
      coalesce(sum(amount_usdt) filter (
        where type = 'FEE' and order_id is null and user_id is not null), 0) as transfer_fees,
      coalesce(sum(amount_usdt) filter (
        where type = 'REFERRAL'), 0) as referral_payouts
    from public.ledger_entries
    where type in ('FEE', 'REFERRAL')
  )
  select trade_fees, withdrawal_fees, transfer_fees, referral_payouts,
         (trade_fees + withdrawal_fees + transfer_fees - referral_payouts) as net
    from agg;
$$;

revoke all on function public.admin_income_breakdown() from public;
grant execute on function public.admin_income_breakdown() to service_role;
