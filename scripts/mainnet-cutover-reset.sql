-- ═══════════════════════════════════════════════════════════════════════════
--  MAINNET CUTOVER RESET
--  Run this ONCE, at the moment you switch the platform from Nile testnet to
--  mainnet. It wipes ALL testnet MONEY, trade history, and reputation, while
--  KEEPING user accounts, KYC verification, ads, and platform settings.
--
--  ⚠️  IRREVERSIBLE. It deletes balances, ledger, orders, withdrawals, etc.
--      TAKE A DATABASE BACKUP / SNAPSHOT FIRST.
--
--  This is NOT a migration (it lives outside supabase/migrations so it never
--  runs automatically). Run it by hand in the Supabase SQL editor (which runs as
--  `postgres`, so the protected-column guard allows the reputation reset).
--
--  WHY: on Nile your balances are test USDT worth $0. On mainnet the code treats
--  every balance as REAL USDT — so carrying them over would make the platform
--  believe it owes users ~1,362 real USDT it never received (instant insolvency)
--  and let them withdraw real money. This zeroes the money so real balances build
--  up only from genuine mainnet deposits.
--
--  RUN ORDER for the whole cutover (do these in sequence):
--    1. Generate a BRAND-NEW mainnet hot wallet + deposit mnemonic (offline,
--       never the testnet keys). Fund it with real TRX (gas) + USDT (float).
--    2. Point env at mainnet: NEXT_PUBLIC_TRON_NETWORK=mainnet, mainnet
--       TRON_USDT_CONTRACT (TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t), the new
--       TRON_HOT_WALLET_ADDRESS / _PRIVATE_KEY, new TRON_DEPOSIT_MNEMONIC,
--       a mainnet TRON_API_KEY. Redeploy.
--    3. ►► Run THIS script (with a backup taken). ◄◄
--    4. In the admin console, verify the hot-wallet reserve reads the NEW wallet,
--       confirm liabilities = 0, then turn Live payments ON.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- 1) Money + trade-history rows. Children first so foreign keys don't block.
delete from public.ledger_entries;      -- refs orders + users
delete from public.messages;            -- refs orders
delete from public.disputes;            -- refs orders
delete from public.chain_txs;           -- on-chain deposit/withdrawal records
delete from public.withdrawals;
delete from public.deposit_intents;
delete from public.unmatched_deposits;
delete from public.notifications;       -- all Nile-era alerts
delete from public.orders;              -- now unreferenced

-- 2) Zero every wallet balance and drop the Nile-derived deposit address (each
--    user re-derives a fresh one on the new mainnet mnemonic on next use).
update public.wallets set
  usdt_available       = 0,
  usdt_locked          = 0,
  usdt_bond            = 0,
  usdt_withdraw_locked = 0,
  usdt_frozen          = 0,
  deposit_address      = null;

-- 3) Zero the platform account — collected fees and forfeited funds.
update public.platform_account set
  usdt_fees      = 0,
  usdt_forfeited = 0;

-- 4) Wipe reputation back to a fresh-account state (as requested). is_admin /
--    is_merchant / kyc_status are deliberately left untouched.
update public.users set
  reputation_score    = 0,
  completed_trades    = 0,
  completion_rate     = 0,
  avg_release_seconds = 0;

-- 5) Reset money-related settings for a clean mainnet start:
--    • live_payments OFF  → start safe; re-enable in the admin console once you've
--      confirmed the new hot wallet reads correctly.
--    • pooled_deposit_address NULL → use the new hot wallet from env.
--    • pooled_scan_from NULL → the new wallet has no prior history to skip.
update public.platform_settings set
  live_payments          = false,
  pooled_deposit_address = null,
  pooled_scan_from       = null
  where id = true;

commit;

-- ── Verify after running (should all be zero / clean) ───────────────────────
-- select (select coalesce(sum(usdt_available+usdt_locked+usdt_bond+usdt_withdraw_locked+usdt_frozen),0) from public.wallets) as liabilities,
--        (select usdt_fees from public.platform_account) as fees,
--        (select count(*) from public.ledger_entries) as ledger_rows,
--        (select count(*) from public.orders) as orders,
--        (select count(*) from public.withdrawals) as withdrawals;
