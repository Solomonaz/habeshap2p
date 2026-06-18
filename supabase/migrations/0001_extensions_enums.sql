-- 0001 — extensions + enum types
-- Foundations for the HabeshaP2P internal-ledger escrow schema.

create extension if not exists pgcrypto; -- gen_random_uuid()

create type ad_side as enum ('BUY', 'SELL');
create type ad_status as enum ('ACTIVE', 'PAUSED', 'CLOSED');

create type order_state as enum (
  'CREATED',   -- USDT locked in escrow ledger
  'PAID',      -- buyer marked paid + uploaded proof
  'RELEASED',  -- seller released; USDT moved to buyer minus fee (terminal)
  'CANCELLED', -- timer expired or dispute favoured seller; USDT returned (terminal)
  'DISPUTED'   -- frozen, awaiting admin decision
);

-- LOCK/UNLOCK/RELEASE/FEE move funds between a user's available and locked
-- balances; DEPOSIT/WITHDRAW mirror on-chain flow. UNLOCK is the cancel-time
-- reversal (the spec describes it but did not name it).
create type ledger_type as enum (
  'LOCK', 'UNLOCK', 'RELEASE', 'FEE', 'DEPOSIT', 'WITHDRAW'
);

-- Whitelisted irreversible payment rails only.
create type payment_method as enum ('TELEBIRR', 'CBE');

create type dispute_status as enum ('OPEN', 'UNDER_REVIEW', 'RESOLVED');
create type dispute_resolution as enum ('FAVOUR_BUYER', 'FAVOUR_SELLER');

create type chain_direction as enum ('IN', 'OUT');
