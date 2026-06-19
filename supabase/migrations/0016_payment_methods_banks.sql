-- 0016_payment_methods_banks.sql
--
-- Widen the `payment_method` enum to cover three more Ethiopian bank rails:
-- Bank of Abyssinia, Awash Bank and Dashen Bank. CBE (a bank) is already on the
-- whitelist, so these are consistent additions to the same family of
-- bank-transfer rails (spec rule #3 — only rails we consider safe to settle on).
--
-- We ADD enum values rather than recreate the type: the type is referenced by
-- ads.payment_methods[] and orders.payment_method, so a drop/recreate would
-- require rewriting those columns. `ADD VALUE IF NOT EXISTS` is idempotent and,
-- on PG12+, safe inside the migration transaction because we do not reference
-- the new values within this same migration.

alter type payment_method add value if not exists 'ABYSSINIA';
alter type payment_method add value if not exists 'AWASH';
alter type payment_method add value if not exists 'DASHEN';
