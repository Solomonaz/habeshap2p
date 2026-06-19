# HabeshaP2P

Peer-to-peer **USDT ↔ ETB** escrow exchange for the Ethiopian diaspora, modeled
on Binance P2P. The crypto side is escrowed via an **internal ledger** (database,
zero per-trade gas); ETB settles directly between traders over Telebirr / CBE.
The platform never touches ETB.

> **Phases 0–7** of an 8-phase build are complete: scaffold + schema + RLS
> (Phase 0), money math + auth + ledger primitives (Phase 1), the live ads /
> order book (Phase 2), the **escrow order state machine** — lock, mark-paid,
> seller-only release, cancel, timer expiry (Phase 3), **in-trade chat +
> payment-proof exchange** (Phase 4), **disputes + admin resolution**
> (Phase 5), **new-user trade limits + merchant collateral bonds**
> (Phase 6), and the **on-chain ramp** — deposit addresses, withdrawal requests
> with an admin-approval threshold, and a server-side signer worker, all behind a
> swappable chain-provider interface (Phase 7), and **production hardening + an
> admin ops console** — append-only audit log, reserve/stats overview, security
> response headers, and scheduled cron workers (Phase 8). Trading is live
> end-to-end: open an order, chat and share proof, release — and when a paid
> trade goes wrong, either party can freeze the escrow for an admin to rule on.
> Fresh accounts trade under per-order caps that grow with completed trades;
> posting a collateral bond lifts the cap entirely.
>
> **Phase 7 ships on a stub chain provider** so the build and review need no real
> keys or funds: the full ledger-side deposit/withdrawal flow, state machine, and
> admin queue are real, but the actual Tron broadcast is mocked until a real
> provider is configured (see *What Phase 7 adds*).

## Stack

- **Next.js** (App Router, TypeScript) + **Tailwind** → Vercel
- **Supabase** — Postgres, Auth (phone OTP), Storage, Realtime, Edge Functions, cron
- **Tron / TRC-20 USDT** (Phase 7) — self-custodied hot wallet, server-side signing only, behind a swappable `ChainProvider` interface (ships on a stub; TronWeb/TronGrid drops in unchanged)

## Prerequisites

- Node.js 20+
- A Supabase project (cloud). No local Docker needed — migrations are plain SQL
  applied to the cloud project.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase values
```

Fill `.env.local` from your Supabase dashboard (**Project Settings → API**):

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public, browser-safe
- `SUPABASE_SERVICE_ROLE_KEY` — **secret**, server-only, bypasses RLS
- `SUPABASE_PROJECT_ID` — used by `npm run db:types`

**Phase 7 / Tron (all optional).** With none set, the app runs on the **stub
chain provider** (deposit addresses are deterministic fakes, nothing broadcasts)
— fine for local dev and review:

- `NEXT_PUBLIC_TRON_NETWORK` — `nile` (default) / `shasta` / `mainnet`
- `WITHDRAWAL_APPROVAL_THRESHOLD` — USDT at/above which a withdrawal needs admin
  sign-off (default `500`)
- `TRON_MIN_CONFIRMATIONS` — confirmations before a deposit is credited (default `20`)
- `TRON_API_KEY`, `TRON_HOT_WALLET_ADDRESS`, `TRON_HOT_WALLET_PRIVATE_KEY` —
  **secret, server-only**; only read when the real provider is wired in. The
  private key must never appear in a `NEXT_PUBLIC_*` var or reach the client
  bundle (rule #6).

## Apply the database migrations

Run the files in `supabase/migrations/` **in order** (0001 → 0013) against your
cloud project. Either:

**A — Supabase CLI** (recommended):

```bash
npx supabase login            # if you hit "Access token not provided"
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

**B — SQL editor:** paste each file (0001 → 0013) into the dashboard SQL editor
and run them in sequence.

> **Realtime publications.** Migrations `0008` and `0009` add the `messages` and
> `orders` tables to the `supabase_realtime` publication. The chat panel needs
> `0008`; the **instant counterparty notifications** (a toast + browser
> notification the moment an order is opened against you, or its state changes)
> need `0009`. Both rely on RLS to scope delivery — a subscriber only receives
> rows it is allowed to `SELECT`, so each user is notified only about their own
> orders. If you applied earlier migrations before `0009` existed, just run
> `0009` on its own.

> **Phase 4 storage bucket.** Migration `0008` creates a **private** Supabase
> Storage bucket `trade-proofs` (via the `storage.buckets` insert) and RLS
> policies on `storage.objects` scoping each object to the two parties of the
> order in its path prefix. The SQL editor and `db push` both run as a privileged
> role, so the bucket + policies apply cleanly. If your project blocks
> `storage.*` DDL, create the `trade-proofs` bucket (set **Public = off**) in the
> dashboard Storage UI and add the two policies from `0008` by hand.

> **Phone OTP needs an SMS provider.** Supabase Auth sends the OTP, but actual
> SMS delivery requires configuring a provider (Twilio / MessageBird / Vonage)
> in **Authentication → Providers → Phone** — that is a paid, per-message vendor
> (not free, despite the spec's $0 line). For local development, enable a test
> phone number in the dashboard, or switch to email OTP, to avoid SMS cost.

Then regenerate the typed schema:

```bash
SUPABASE_PROJECT_ID=<ref> npm run db:types
```

(The committed `src/lib/supabase/database.types.ts` is a hand-written stub that
already matches the migrations, so the app type-checks before you do this.)

## Run / verify

```bash
npm run dev        # http://localhost:3000 — landing + escrow-rail preview
npm run typecheck  # tsc --noEmit
npm run lint
npm run test       # vitest — money-math + escrow/dispute/bond/withdrawal conservation + trade-limit + approval-threshold tests
```

## What Phase 0 contains

| Area | Files |
| --- | --- |
| App shell + design tokens | `src/app/*`, `tailwind.config.ts` |
| Env validation (fails loudly) | `src/lib/env.ts` |
| Supabase clients | `src/lib/supabase/{client,server}.ts` |
| Typed schema | `src/lib/supabase/database.types.ts` |
| Domain enums | `src/types/domain.ts` |
| Schema + RLS | `supabase/migrations/0001…0004.sql` |

## What Phase 1 adds

| Area | Files |
| --- | --- |
| Exact-decimal money math (+ tests) | `src/lib/money.ts`, `tests/money.test.ts` |
| Ledger primitive SQL (deposit/lock/unlock/withdraw) | `supabase/migrations/0005_ledger_functions.sql` |
| Server-side ledger service | `src/lib/ledger.ts` |
| Phone OTP auth + route protection | `middleware.ts`, `src/lib/supabase/middleware.ts`, `src/app/login/*` |
| Account dashboard (wallet + reputation) | `src/app/dashboard/*` |

## What Phase 2 adds

| Area | Files |
| --- | --- |
| Realtime publication on `ads` | `supabase/migrations/0006_realtime_ads.sql` |
| Order-book + my-ads data access | `src/lib/ads.ts`, `src/lib/labels.ts`, `src/lib/format.ts` |
| Live order book (filter by side, sort, Realtime) | `src/app/market/page.tsx`, `src/app/market/order-book.tsx` |
| Post an ad (zod-validated, RLS insert) | `src/app/market/new/*` |
| Manage own ads (pause / activate / close) | `src/app/market/mine/*` |
| Shared nav header | `src/components/site-header.tsx` |

The order book is **interactive**: it subscribes to `postgres_changes` on `ads`
and refetches on every change (which also re-pulls poster reputation), so new and
edited ads appear without a reload — a live "Connecting…/Live" dot reflects the
socket state. Filtering by side and sorting by rate happen client-side.

Ads are inserted **as the user** through the RLS session client; the insert policy
requires `user_id = auth.uid()`, so a forged poster id is rejected by Postgres, not
merely trusted in the action. Poster reputation is read from the `public_profiles`
view (safe columns only) because RLS forbids reading other users' `users` rows.

Money is handled as integer **micro-USDT** (`BigInt`) end-to-end — never floats.
The ledger SQL functions are `SECURITY DEFINER` with `EXECUTE` granted to
`service_role` **only**, so a client can never mint or move balances; they run
in a transaction with `SELECT … FOR UPDATE` row locks to prevent double-spend.

## What Phase 3 adds

| Area | Files |
| --- | --- |
| Escrow orchestration (create / mark-paid / release / cancel / expire) | `supabase/migrations/0007_escrow_orchestration.sql` |
| Typed RPC wrappers + order reads | `src/lib/orders.ts` |
| Trade panel (open an order against an ad) | `src/app/market/trade/[adId]/*` |
| Order detail + lifecycle controls | `src/app/orders/[id]/*` |
| Orders list | `src/app/orders/page.tsx` |
| Escrow status rail | `src/components/escrow-rail.tsx` |
| Auto-cancel cron endpoint | `src/app/api/cron/expire-orders/route.ts` |
| Dev faucet (test USDT) | `src/app/dashboard/actions.ts` |
| Release-math + lifecycle conservation tests | `tests/orders.test.ts` |

The order state machine lives **entirely in Postgres** (`order_create`,
`order_mark_paid`, `order_release`, `order_cancel`, `order_expire_unpaid`). Each
is `SECURITY DEFINER`, granted to `service_role` only, and runs in one
transaction with `SELECT … FOR UPDATE` row locks. The server wrappers in
`orders.ts` run as `service_role` but **pass the authenticated user as the
actor**, and the SQL re-checks the actor is the right party — so authorization
is enforced in the database, not merely trusted in the action layer.

The four non-negotiable escrow rules are enforced here:

1. **No auto-release.** `order_mark_paid` (the buyer's "I've paid" claim) moves
   **zero** balance. USDT only leaves escrow via `order_release`, which requires
   the actor to be the **seller** (or, later, admin dispute resolution).
2. **Real-name matching.** The buyer's payment-account name is stored on the
   order and shown prominently to the seller, who is told to refuse on any
   mismatch. (For `SELL` ads the taker supplies it at order time; for `BUY` ads
   the advertiser sets it on the ad.)
3. **Irreversible rails only.** Payment methods stay whitelisted to Telebirr / CBE.
4. **Timer auto-cancel.** `order_expire_unpaid` cancels `CREATED` orders past
   their deadline and returns the locked USDT to the seller, driven by the
   secret-guarded cron endpoint.

On release, the taker fee (**0.25% / 25 bps**, half-up rounded) is split off to a
singleton `platform_account` and the buyer receives the net — `fee + net == amount`
is asserted in `tests/orders.test.ts`, alongside whole-lifecycle conservation
(seller + buyer + platform total is invariant through lock → release and
lock → cancel).

### Running the escrow flow locally

1. Apply migration `0007` (dashboard SQL editor or `supabase db push`).
2. Sign in as two phone numbers (two browsers / profiles).
3. On `/dashboard`, use the **dev faucet** to credit test USDT to whichever
   account will be the seller. (The faucet calls `ledger_deposit` and is
   **hard-disabled when `NODE_ENV === "production"`** — it mints balance and must
   never ship enabled.)
4. Post an ad, open it from the other account, walk it through paid → release.
5. To exercise the timer, hit `GET /api/cron/expire-orders` with
   `Authorization: Bearer $CRON_SECRET` after an order's window elapses.

## What Phase 4 adds

| Area | Files |
| --- | --- |
| Chat realtime + private proof bucket | `supabase/migrations/0008_chat_realtime_storage.sql` |
| Orders Realtime publication (for notifications) | `supabase/migrations/0009_orders_realtime.sql` |
| Messages data access + signed-URL helpers | `src/lib/messages.ts` |
| Realtime chat + proof-upload panel | `src/app/orders/[id]/order-chat.tsx` |
| Instant counterparty notifications (toast + browser) | `src/components/order-notifications.tsx`, `src/components/site-header.tsx` |
| Synthetic trader handles/avatars | `src/lib/handle.ts` |
| Binance-style order book (tabs, filters, cards) | `src/app/market/order-book.tsx`, `src/lib/labels.ts` |

**In-trade chat.** Each order has a live buyer↔seller chat backed by the
`messages` table (already RLS-scoped to the two parties in `0004`). New messages
arrive over Realtime, filtered to the order. The log is **immutable** — there is
no UPDATE/DELETE policy or privilege — so it stands as clean evidence for a
Phase 5 dispute.

**Payment proof.** Messages can carry an image (bank-transfer screenshot).
Images live in a **private** `trade-proofs` bucket; `messages.image_url` stores
the object *path*, not a URL, and the UI renders each via a short-lived **signed
URL**. Storage RLS keys off the order id in the object path, so a user can
neither upload nor read proofs for an order they aren't part of.

**Instant notifications.** Mounted in the shared header, `OrderNotifications`
subscribes to Realtime on the `orders` table. The instant another user opens an
order against you — or any order you're party to changes state (paid, released,
cancelled, disputed) — you get an in-app **toast** (clickable, routes to the
order) plus a native **browser notification** if you've granted permission. No
column filter is used: RLS already limits delivered rows to your own orders, so
the counterparty is notified and nobody else. Requires migration `0009`.

**Order book glow-up.** Taker-perspective **Buy/Sell** tabs (Buy lists ads where
the advertiser sells USDT, sorted cheapest-first; Sell the reverse), an ETB fiat
chip, amount + payment-method filters, and per-row cards with avatar, merchant
badge, trade-count/completion stats, colour-coded payment chips, the ETB price
and the derived USDT quantity range. Live updates still flow over Realtime. Your
**own ads are filtered out** of the Buy/Sell lists (you can't trade against
yourself — manage them under *My ads*); RLS still returns them to you, so the
exclusion is done client-side by matching the current user id.

## What Phase 5 adds

| Area | Files |
| --- | --- |
| Dispute state machine (open + admin resolve) | `supabase/migrations/0010_disputes.sql` |
| Dispute TS wrappers + admin reads | `src/lib/disputes.ts`, `src/lib/admin.ts` |
| Party dispute UI (open / status) | `src/app/orders/[id]/order-controls.tsx`, `actions.ts` |
| Admin dispute queue | `src/app/admin/page.tsx` |
| Admin ruling console (evidence + resolve) | `src/app/admin/disputes/[id]/*`, `src/app/admin/actions.ts` |
| Admin nav link (is_admin–gated) | `src/components/site-header.tsx` |

This closes the two transitions the Phase 3 state machine left open:

```
PAID     → DISPUTED    (either party escalates a paid-but-unreleased order)
DISPUTED → RELEASED    (admin rules FOR THE BUYER  → escrow goes to the buyer)
DISPUTED → CANCELLED   (admin rules FOR THE SELLER → escrow returns to seller)
```

**Opening a dispute.** Once an order is `PAID`, neither side can act
unilaterally (the seller can still release, but the timer no longer auto-cancels
and there is no unilateral cancel). If the trade is stuck — buyer paid but the
seller won't release, or the seller says the ETB never arrived / the payer name
doesn't match — either party submits a reason via `order_open_dispute`. The
order flips to `DISPUTED` and the escrow **freezes**: no release, cancel, or
expiry path will touch it until an admin rules. A `unique (order_id)` constraint
means one dispute per order.

**Admin resolution.** `dispute_resolve` is the *only* new way escrow can move,
and it is **service-role + `is_admin`-gated three times over**: the `/admin`
route guard, the server action (re-fetches `is_admin`), and the SQL function
itself (re-checks `is_admin` before moving a cent). This upholds **rule #1** —
USDT still only reaches the buyer via the seller's own release *or* an admin
ruling, never automatically on the buyer's word.

- **Favour buyer** → escrow is released to the buyer and the order becomes
  `RELEASED`.
- **Favour seller** → escrow is returned to the seller and the order becomes
  `CANCELLED`.

A dispute ruling charges **no taker fee** — the 0.25% fee applies to a
*successful, uncontested* trade; an admin-arbitrated outcome moves the full
locked amount to whoever the admin rules for. Conservation is asserted for both
branches in `tests/orders.test.ts`. Disputed trades also **don't bump
reputation/completion stats** for either party (flagged below).

**The admin console** (`/admin`) lists open disputes; each detail page shows the
order facts, the buyer's payer-name, and the **full immutable chat transcript
with signed proof images**, then offers a two-step "Release to buyer / Return to
seller" ruling. Admins are not parties to the orders they arbitrate, so RLS would
hide everything from them — these reads deliberately go through the service-role
client behind the route's `is_admin` guard.

> **Bootstrapping the first admin.** There is no UI to grant admin (by design —
> `is_admin` is a server-maintained, trigger-protected column). Flip it directly
> in the dashboard SQL editor for your own user:
>
> ```sql
> update public.users set is_admin = true where id = '<your-user-uuid>';
> ```
>
> The **Admin** nav link then appears for that account, and `/admin` becomes
> reachable (everyone else is redirected to `/market`).

## What Phase 6 adds

| Area | Files |
| --- | --- |
| Bond column + ledger types + limit/bond functions | `supabase/migrations/0011_merchant_bonds_limits.sql` |
| Trade-tier + limit helpers (TS mirror of the SQL) | `src/lib/reputation.ts` |
| Merchant-bond server wrappers | `src/lib/merchant.ts` |
| Merchant-bond panel + post/release actions | `src/app/dashboard/merchant-bond.tsx`, `actions.ts` |
| Trade-limit display + over-limit guard | `src/app/market/trade/[adId]/*` |
| Bond conservation + tier tests | `tests/orders.test.ts` |

This delivers **rule #5** — abuse limits scaled by reputation, with a real
collateral bond as the escape hatch for high-volume traders.

**New-user trade limits.** Every order is checked against a per-order USDT cap
for *both* parties inside `order_create` (so a client that skips the UI still
can't trade over the limit):

```
brand-new account (0 trades)   →    100 USDT
≥ 1 completed trade            →  1,000 USDT
≥ 10 completed trades          → 10,000 USDT
merchant (bonded)              → unlimited
```

The same thresholds live in `src/lib/reputation.ts` (`tradeLimitUsdt`) so the
trade form can show the cap and disable submit before the round-trip — but the
SQL `_trade_limit_usdt` is authoritative. **Keep the two in sync.**

**Merchant collateral bond.** A user locks USDT as a bond via
`merchant_post_bond` (available → a new `wallets.usdt_bond` bucket, with a
`BOND_LOCK` ledger line). Crossing the **500 USDT** minimum promotes them to
merchant — `is_merchant = true`, no per-order cap. The bond is real escrowed
skin-in-the-game: it stays the user's money but is held until they step down via
`merchant_release_bond` (bond → available, `BOND_RELEASE` line, `is_merchant =
false`), which **refuses while any of their orders is live** (`CREATED`/`PAID`/
`DISPUTED`). The bond never leaves the conserved set — the invariant simply
extends to `available + locked + bond + platform_fees`, asserted in
`tests/orders.test.ts`.

> **Bonds are not yet slashable.** This phase gates merchant standing and the
> uncapped limit on a posted bond, but there is no admin path to *seize* a bond
> on bad behaviour — a malicious merchant can always release it (once they have
> no live orders). Slashing on an adverse dispute ruling is a natural follow-up,
> flagged below.

## What Phase 7 adds

| Area | Files |
| --- | --- |
| Deposit/withdrawal state machine + hold bucket + ledger types | `supabase/migrations/0012_chain_deposits_withdrawals.sql` |
| Swappable chain-provider interface + stub | `src/lib/chain/{provider,stub,config,index}.ts` |
| Deposit service (address derivation + poller) | `src/lib/deposits.ts` |
| Withdrawal service + signer worker | `src/lib/withdrawals.ts` |
| Deposit-poll + withdrawal-signer cron endpoints | `src/app/api/cron/{poll-deposits,process-withdrawals}/route.ts` |
| Deposit card + withdrawal form + history | `src/app/dashboard/{page,withdraw-form}.tsx`, `actions.ts` |
| Admin withdrawal-approval queue | `src/app/admin/withdrawals/*`, `src/app/admin/actions.ts` |
| Withdrawal-hold conservation + approval-threshold tests | `tests/orders.test.ts` |

This builds the **on-chain ramp** that lets real USDT enter and leave the
internal ledger, while keeping every cent honest under the conservation
invariant — and it enforces **rule #6** (key safety + signing controls).

**A swappable chain provider.** Nothing in the app talks to Tron directly;
everything goes through a `ChainProvider` interface (`deriveDepositAddress`,
`fetchIncomingTransfers`, `sendUsdt`, `isConfirmed`). Phase 7 ships the
`StubChainProvider` — deterministic fake addresses, no inbound transfers, and a
`sendUsdt` that **throws in production** — so the build and review need no keys
or funds. When the real integration lands, `getChainProvider()` is the single
place to construct a TronWeb/TronGrid-backed provider; nothing else changes.

**Deposits.** Each user gets a stable deposit address (derived once, persisted
via `wallet_set_deposit_address`). A secret-guarded cron (`/api/cron/poll-deposits`)
scans assigned addresses for confirmed inbound USDT and credits the matching
user via `credit_deposit`, which is **idempotent on tx hash** (a `chain_txs`
unique constraint + `ON CONFLICT DO NOTHING`), so re-runs and crashes can't
double-credit. A deposit is the one operation that **mints** internal balance.

**Withdrawals.** A request moves `available → usdt_withdraw_locked` (a new hold
bucket) with a `WITHDRAW_LOCK` ledger line and queues the row. Amounts **at or
above the approval threshold (500 USDT)** land in `PENDING_APPROVAL`; smaller
ones go straight to `APPROVED`. The SQL receives the threshold and is
authoritative; the constant in `src/lib/chain/config.ts` only drives the UI
warning — **keep the two in sync.** Held funds stay inside the conserved set
until they're actually sent, so a reject or a failed broadcast **refunds** them
(`WITHDRAW_UNLOCK`, back to `available`). Broadcasting is the one operation that
**burns** internal balance (the USDT has left the system).

```
request  → usdt_withdraw_locked held → PENDING_APPROVAL (≥500) | APPROVED (<500)
approve  → APPROVED          reject → REJECTED (held funds refunded)
signer   → APPROVED → SENT (funds burned) | FAILED (held funds refunded)
         → SENT → CONFIRMED (chain confirmed)
```

**The signer worker is the only thing that signs.** `processApprovedWithdrawals`
(driven by `/api/cron/process-withdrawals`) is the **sole caller** of
`sendUsdt`. It runs server-side, reads the hot-wallet key only from the secret
store, logs every signing attempt (without secrets — the address is truncated,
the key never printed), and marks each row `SENT` (burn) or `FAILED` (refund).
It is reachable **only** from the secret-guarded cron, never from a user-facing
action — broadcasting money must never be one request away from the browser.

**Admin approval queue.** `/admin/withdrawals` lists `PENDING_APPROVAL` requests;
approve/reject are **`is_admin`-gated three times over** (route guard → server
action re-check → SQL re-check), the same model as dispute resolution. Approving
only flags the row for the signer; the cron does the actual broadcast.

The conservation invariant now reads **`available + locked + bond +
usdt_withdraw_locked + platform_fees` is constant — except deposits raise it
(mint) and broadcast withdrawals lower it (burn)**, asserted across the new
withdrawal-hold tests in `tests/orders.test.ts`.

## What Phase 8 adds (production hardening + ops console)

| Area | Files |
| --- | --- |
| Append-only admin audit log + `record_admin_action` + `platform_stats` | `supabase/migrations/0013_admin_audit_ops.sql` |
| Audit service (record + fetch) | `src/lib/audit.ts` |
| Reserve/stats summariser (pure, testable) + service-role fetch | `src/lib/platform.ts`, `src/lib/ops.ts` |
| Ops overview console | `src/app/admin/overview/page.tsx` |
| Security response headers (CSP, HSTS, etc.) | `next.config.ts` |
| Cron schedules | `vercel.json` |
| Landing-page polish (trust points + footer) | `src/app/page.tsx` |
| Reserve-summary reconciliation tests | `tests/orders.test.ts` |

Phase 8 is the capstone: it makes the platform **observable and operable** for an
admin, hardens the HTTP surface, and schedules the background workers — without
inventing any paid service.

**Append-only admin audit log.** Every privileged action that moves money or
state — dispute resolution, withdrawal approve/reject — now also writes an
immutable row via `record_admin_action` (SECURITY DEFINER, re-checks `is_admin`).
The `admin_audit_log` table has **no UPDATE or DELETE policy**, so rows can only
be appended, never altered or erased. Logging is **best-effort**: a failed audit
write logs an error but never blocks or rolls back the action it records (the
ledger remains the source of truth for funds).

**Ops overview console (`/admin/overview`).** `platform_stats()` (SECURITY
DEFINER) sums every wallet bucket and the platform fee account in one round-trip
and returns amounts as `::text` (no lossy float JSON) plus operational counts
(users, merchants, active ads, open orders, open disputes, pending withdrawals).
`summarizeReserves()` is a **pure** function (no `server-only` import, fully
unit-tested) that re-derives the totals in BigInt micros and sets a
`reconciles` flag by comparing the SQL-reported `liabilities` / `total_supply`
against the recomputed sums. The page shows a **red conservation banner** if they
ever diverge. This is a **self-consistency check, not an on-chain reserve proof.**

**Security response headers.** `next.config.ts` now applies a strict CSP, HSTS
(2-year `max-age`, `includeSubDomains; preload`), `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, a tight `Referrer-Policy`, a
`Permissions-Policy` that disables camera/mic/geolocation/payment, and
`X-DNS-Prefetch-Control: off` to every route.

**Scheduled crons.** `vercel.json` schedules the three secret-guarded workers —
`expire-orders` every 2 min, `poll-deposits` and `process-withdrawals` every
5 min — so orders expire, deposits credit, and withdrawals broadcast without a
human hitting the endpoints.

## Security model (read before touching keys)

- **The hot-wallet private key never lives in the repo or client code.** It is
  read only on the server (`getServerEnv`, never `NEXT_PUBLIC_*`), and only the
  cron signer worker (`processApprovedWithdrawals`) ever signs — never a
  user-facing action. Every signing attempt is logged without secrets. A single
  leaked key drains every user's USDT, irreversibly.
- **Withdrawals over the threshold need a human.** Requests ≥ 500 USDT sit in
  `PENDING_APPROVAL` until an admin approves; the gate is enforced in SQL, not
  just the UI. The signer only broadcasts `APPROVED` rows.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. It is only ever read in server code
  (`createAdminSupabase`), which is marked `server-only` so it cannot be bundled
  into the client.
- Balances and order-state transitions are **never written by the client** — only
  by server-side transactional RPCs (Phase 1/3/5). RLS grants clients read access
  to their own rows and nothing more.
- **Admin powers** (dispute resolution) move escrow across users, so they run via
  the service role with an `is_admin` check enforced in the SQL itself — not just
  in the route. `is_admin` is a trigger-protected column a user cannot set on
  themselves.

## Known residual risks (per spec §2.4 / §9.1)

These are deliberately not solved in the minimum-cost MVP:

- **Fake ETB payment proof** — ETB settles off-platform with no paid bank-API
  verification. Mitigated by irreversible-rail whitelist, reputation, new-user
  limits, and manual dispute resolution; not eliminated.
- **Hot-wallet key security** — self-custody means key safety is entirely on the
  operator. Cold storage for bulk funds + small hot float + withdrawal approval
  threshold are the MVP controls.
- **KYC / identity** — no vendor; banned users can re-register. Phone+device
  binding raises the cost only.

Phase-3 specific gaps flagged for later phases:

- **On-chain deposit/withdrawal runs on a stub provider.** Phase 7 wires the full
  ledger-side ramp, but real Tron broadcast needs a real provider configured (see
  *What Phase 7 adds* and the Phase-7 gaps below). Until then the **dev faucet** is
  the only credit path, and it is disabled in production.
- **Cron is scheduled via `vercel.json` (Phase 8).** The expiry, deposit-poll,
  and withdrawal-signer endpoints are secret-guarded and now wired to Vercel Cron
  (`expire-orders` every 2 min; `poll-deposits` + `process-withdrawals` every
  5 min). On a non-Vercel host you must wire an equivalent scheduler sending
  `Authorization: Bearer $CRON_SECRET` to the same paths, or those workers never
  run.

Phase-4 specific gaps flagged for later phases:

- **No real display names / presence.** Accounts are phone-bound with no
  username, so the order book shows **synthetic, deterministic handles + avatars**
  derived from the user id (`src/lib/handle.ts`) — cosmetic only, not an identity
  or trust signal. Live "online" status and per-ad available inventory (shown by
  Binance) are intentionally omitted: surfacing them would require presence
  tracking and exposing other users' wallet balances, which RLS forbids. The card
  shows the derived USDT **quantity range** from the ad's public limits instead.
- **Proof images are unscanned.** Uploads are size/MIME-checked client-side only
  and stored as-is. There is no server-side validation, virus scan, or EXIF
  stripping yet; the bucket is private and signed-URL-gated, which limits but does
  not eliminate the risk.
- **Chat is unmoderated and unencrypted at rest** beyond Supabase's defaults.
  Fine for MVP dispute evidence; a production build wants abuse controls.

Phase-5 specific gaps flagged for later phases:

- **Admin rulings are unaudited beyond the ledger.** A resolution writes the
  outcome (`resolved_by`, `resolved_at`, `resolution`) and ledger entries, but
  there is no separate immutable admin-action audit log, no second-approver
  requirement for large amounts, and no rate-limit on a rogue admin. For MVP a
  trusted, hand-bootstrapped admin set is assumed.
- **Disputes only open from `PAID`.** A `CREATED` (unpaid) order can't be
  disputed — it's simply cancellable and the timer auto-cancels it. This matches
  the threat model (disputes are about contested *payment*) but means an edge
  case where a buyer pays without marking paid relies on them marking paid first.
- **No dispute SLA / auto-resolution.** A `DISPUTED` order stays frozen
  indefinitely until an admin acts; there is no timeout that auto-rules or
  escalates. The escrow is safe (frozen), but a missing admin strands funds.
- **Disputed trades don't affect reputation.** `dispute_resolve` deliberately
  skips the reputation bump so a contested outcome neither rewards nor penalises
  either party automatically. A production system likely wants a "lost dispute"
  signal feeding reputation — out of scope for the MVP.

Phase-6 specific gaps flagged for later phases:

- **Bonds aren't slashable.** Merchant standing is gated on a posted bond, but
  there is no admin path to seize it on an adverse dispute ruling — a merchant
  can always release it once they have no live orders. Slashing on a lost
  dispute is the natural follow-up.
- **Trade limits are per-order, not cumulative.** The cap bounds a single
  order's size; it does not limit how many capped-size orders a new user opens
  in a window. Velocity/rolling-volume limits and the device-fingerprint signal
  (the column exists, unused) are deferred.
- **The bonded-merchant limit is all-or-nothing.** Posting ≥ 500 USDT removes
  the cap entirely rather than scaling the limit to the bond size. A
  bond-proportional limit (e.g. trade up to N× your bond) is a future refinement.
- **Reputation score is still just `completed_trades`.** Phase 6 refined limits
  and merchant standing but left `reputation_score` as the raw completed count
  (set in `_bump_reputation`); a weighted score (volume, age, dispute losses) is
  out of scope for the MVP.

Phase-7 specific gaps flagged for later phases:

- **No real Tron provider yet.** Ships on `StubChainProvider`: deposit addresses
  are deterministic fakes, the poller finds nothing, and `sendUsdt` throws in
  production. The real TronWeb/TronGrid provider — address derivation from an HD
  seed or per-user accounts, TRC-20 transfer reads, signing + broadcast, and real
  confirmation polling — is the remaining work, dropped in behind the unchanged
  `ChainProvider` interface at `getChainProvider()`.
- **Single hot wallet, no cold-storage split.** The design assumes one
  self-custodied hot wallet signs every withdrawal. The spec's "bulk cold / small
  hot float" control (sweep deposits to cold storage, top the hot wallet up to a
  float) is not implemented — a hot-wallet compromise is bounded only by its
  balance, which here is the whole balance.
- **Approval queue, but no deeper signer controls.** Withdrawals ≥ 500 USDT need
  one admin approval; there is no second-approver for very large amounts, no
  per-period withdrawal velocity cap, and no allow-listed destination addresses.
- **Deposit crediting trusts the provider's confirmation count.** `credit_deposit`
  is idempotent on tx hash, but "is this transfer final?" is delegated to the
  provider (`DEPOSIT_MIN_CONFIRMATIONS`); a chain reorg deeper than that window
  would credit a deposit that later vanishes. The 20-confirmation default is the
  only mitigation.
- **`ALTER TYPE … ADD VALUE` in migration 0012.** The new ledger-enum values and
  the withdrawal-status enum mean `0012` can't run wrapped in a single
  transaction with the functions that use them; the migration sets
  `check_function_bodies = off` and is written to apply statement-by-statement.
  Apply it via the SQL editor (or `db push`, which runs statements individually);
  don't paste it inside a manual `BEGIN … COMMIT`.

Phase-8 specific gaps flagged for later:

- **No rate-limiting or error monitoring.** Per-IP/per-user request throttling
  (OTP requests, withdrawal requests, login attempts) and error/uptime monitoring
  both want an external service (Upstash/Redis, Sentry, etc.) that costs money and
  state we deliberately don't provision in the minimum-cost MVP. The hooks are
  obvious — middleware for throttling, an error boundary + reporter for
  monitoring — but they're **not built**.
- **CSP relies on `'unsafe-inline'` and `'unsafe-eval'` for scripts.** Next's
  hydration bootstrap uses inline scripts, so the script-src is loose. Tightening
  it to a per-request **nonce** (or hashes) is the follow-up; until then the CSP
  hardens everything *except* inline-script injection.
- **The audit log is written from server actions, not DB triggers.** A direct
  service-role write that bypasses the action layer (e.g. a future script) would
  move funds without an audit row. Enforcing the log in-database via triggers on
  the affected tables is the stronger design; for the trusted-admin MVP the
  action-layer write is accepted.
- **`reconciles` is a self-consistency check, not a reserve proof.** It confirms
  the ledger's internal arithmetic is consistent (buckets + fees = reported
  totals); it does **not** prove the on-chain hot-wallet balance covers internal
  liabilities. A real proof-of-reserves needs the chain balance read from the
  provider and compared — deferred with the real Tron provider.
- **Single hot wallet, still no cold-storage split** (carried from Phase 7): the
  ops console surfaces total liabilities but there is no automated sweep-to-cold
  or hot-float top-up.
