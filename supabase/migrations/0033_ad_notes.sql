-- 0033 — optional advertiser notes on an ad
--
-- Lets the person posting an ad add a free-text note shown to anyone who opens it
-- (online hours, payment timing, special instructions, etc.). Optional and capped
-- so it can't be abused as an unbounded text dump. No behaviour change to matching
-- or escrow — it's purely informational, surfaced on the trade screen.

alter table public.ads
  add column if not exists notes text
    check (notes is null or length(notes) <= 500);
