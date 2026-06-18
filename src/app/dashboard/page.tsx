import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { formatUsdt } from "@/lib/money";
import { reputationTier, tradeLimitUsdt } from "@/lib/reputation";
import {
  TRON_NETWORK,
  TRON_NETWORK_LABEL,
  DEPOSIT_MIN_CONFIRMATIONS,
  WITHDRAWAL_APPROVAL_THRESHOLD,
} from "@/lib/chain";
import { ensureDepositAddress } from "@/lib/deposits";
import { fetchWithdrawalsForUser } from "@/lib/withdrawals";
import { SiteHeader } from "@/components/site-header";
import { MerchantBond } from "./merchant-bond";
import { WithdrawForm } from "./withdraw-form";
import { devFaucet } from "./actions";

const WITHDRAWAL_STATUS_LABEL: Record<string, string> = {
  PENDING_APPROVAL: "Awaiting admin review",
  APPROVED: "Approved — queued to send",
  SENT: "Broadcast — awaiting confirmation",
  CONFIRMED: "Confirmed on-chain",
  REJECTED: "Rejected — funds returned",
  FAILED: "Failed — funds returned",
};

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already guards this route; this is defence-in-depth.
  if (!user) redirect("/login");

  // Both reads run AS THE USER, so RLS returns only their own rows.
  const [{ data: wallet }, { data: profile }] = await Promise.all([
    // Cast numeric → text so PostgREST returns exact decimal strings, not
    // JS-float-lossy JSON numbers. Money is parsed from these strings.
    supabase
      .from("wallets")
      .select("usdt_available::text, usdt_locked::text, usdt_bond::text")
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("users")
      .select("reputation_score, completed_trades, completion_rate, is_merchant")
      .eq("id", user.id)
      .single(),
  ]);

  const available = wallet?.usdt_available ?? "0";
  const locked = wallet?.usdt_locked ?? "0";
  const bond = wallet?.usdt_bond ?? "0";

  // Derive + persist a deposit address on first visit, then list the user's
  // withdrawals (both run server-side; the read is RLS-scoped to this user).
  const depositAddress = await ensureDepositAddress(supabase, user.id);
  const withdrawals = await fetchWithdrawalsForUser(supabase, user.id);

  const isMerchant = profile?.is_merchant ?? false;
  const completedTrades = profile?.completed_trades ?? 0;
  const tier = reputationTier({ isMerchant, completedTrades });
  const tradeLimit = tradeLimitUsdt({ isMerchant, completedTrades });

  return (
    <>
      <SiteHeader phone={user.phone} active="dashboard" userId={user.id} />
      <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-xl font-semibold text-ink">Account</h1>

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-card border border-paper-border bg-paper-raised p-5">
          <p className="text-sm text-ink-muted">Available</p>
          <p className="mt-1 font-amount text-2xl text-ink">
            {formatUsdt(available)}
          </p>
          <p className="text-xs text-ink-faint">USDT you can trade or withdraw</p>
        </div>
        <div className="rounded-card border border-paper-border bg-paper-raised p-5">
          <p className="text-sm text-ink-muted">Locked in escrow</p>
          <p className="mt-1 font-amount text-2xl text-state-locked">
            {formatUsdt(locked)}
          </p>
          <p className="text-xs text-ink-faint">Held against open orders</p>
        </div>
      </section>

      <section className="mt-4 rounded-card border border-paper-border bg-paper-raised p-5">
        <h2 className="text-sm font-medium text-ink-muted">Reputation</h2>
        <dl className="mt-3 grid grid-cols-3 gap-4 text-center">
          <div>
            <dt className="text-xs text-ink-faint">Score</dt>
            <dd className="font-amount text-lg text-ink">
              {profile?.reputation_score ?? 0}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">Completed</dt>
            <dd className="font-amount text-lg text-ink">
              {profile?.completed_trades ?? 0}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">Completion</dt>
            <dd className="font-amount text-lg text-ink">
              {profile?.completion_rate ?? 0}%
            </dd>
          </div>
        </dl>
      </section>

      <MerchantBond
        isMerchant={isMerchant}
        tier={tier}
        tradeLimit={tradeLimit}
        bond={bond}
        available={available}
      />

      {process.env.NODE_ENV !== "production" && (
        <section className="mt-4 rounded-card border border-amber/40 bg-amber-wash p-5">
          <h2 className="text-sm font-medium text-amber">Dev faucet</h2>
          <p className="mt-1 text-xs text-ink-faint">
            Mints test USDT so you can trade before the on-chain deposit flow
            (Phase 7) exists. Never enabled in production.
          </p>
          <form action={devFaucet} className="mt-3 flex items-center gap-2">
            <input
              type="text"
              name="amount"
              defaultValue="1000"
              inputMode="decimal"
              className="w-32 rounded-md border border-paper-border bg-paper px-3 py-1.5 font-amount text-sm text-ink focus:border-amber focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-md bg-amber px-4 py-1.5 text-sm font-semibold text-paper hover:bg-amber-soft"
            >
              Credit USDT
            </button>
          </form>
        </section>
      )}

      <section className="mt-4 rounded-card border border-paper-border bg-paper-raised p-5">
        <h2 className="text-sm font-medium text-ink">Deposit USDT</h2>
        <p className="mt-1 text-xs text-ink-faint">
          Send TRC-20 USDT to this address. It&apos;s credited after{" "}
          {DEPOSIT_MIN_CONFIRMATIONS} confirmations.
        </p>
        <p className="mt-3 break-all rounded-md bg-paper-sunken px-3 py-2 font-amount text-sm text-ink">
          {depositAddress}
        </p>
        <p className="mt-2 text-xs text-amber">
          Only send USDT on {TRON_NETWORK_LABEL[TRON_NETWORK]}. Funds sent on any
          other network or token are unrecoverable.
        </p>
      </section>

      <WithdrawForm
        available={available}
        networkLabel={TRON_NETWORK_LABEL[TRON_NETWORK]}
        approvalThreshold={WITHDRAWAL_APPROVAL_THRESHOLD}
      />

      {withdrawals.length > 0 && (
        <section className="mt-4 rounded-card border border-paper-border bg-paper-raised p-5">
          <h2 className="text-sm font-medium text-ink">Withdrawal history</h2>
          <ul className="mt-3 space-y-2">
            {withdrawals.map((w) => (
              <li
                key={w.id}
                className="rounded-md border border-paper-border bg-paper px-3 py-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-amount text-sm text-ink">
                    {formatUsdt(w.amount_usdt)} USDT
                  </span>
                  <span className="text-xs text-ink-muted">
                    {WITHDRAWAL_STATUS_LABEL[w.status] ?? w.status}
                  </span>
                </div>
                <p className="mt-1 break-all font-amount text-xs text-ink-faint">
                  → {w.to_address}
                </p>
                {w.tx_hash && (
                  <p className="break-all font-amount text-xs text-ink-faint">
                    tx {w.tx_hash}
                  </p>
                )}
                {w.failure_reason && (
                  <p className="mt-1 text-xs text-sell">{w.failure_reason}</p>
                )}
                <p className="mt-1 text-xs text-ink-faint">
                  {new Date(w.created_at).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
      </main>
    </>
  );
}
