import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { formatUsdt, toMicros, fromMicros } from "@/lib/money";
import { reputationTier, tradeLimitUsdt } from "@/lib/reputation";
import {
  TRON_NETWORK,
  TRON_NETWORK_LABEL,
  DEPOSIT_MIN_CONFIRMATIONS,
  WITHDRAWAL_APPROVAL_THRESHOLD,
} from "@/lib/chain";
import { ensureDepositAddress } from "@/lib/deposits";
import { fetchWithdrawalsForUser } from "@/lib/withdrawals";
import {
  isLivePaymentsEnabled,
  getTradePolicy,
  getSweepStrategy,
  getWithdrawalFee,
  getInternalTransferFee,
  getReferralBps,
  getReferralMaxTrades,
} from "@/lib/settings";
import { getReferralStats } from "@/lib/referrals";
import { SITE_URL } from "@/lib/site";
import { SiteHeader } from "@/components/site-header";
import { accountLabel } from "@/lib/identity";
import Link from "next/link";
import { MerchantBond } from "./merchant-bond";
import { WithdrawForm } from "./withdraw-form";
import { InternalTransferForm } from "./internal-transfer-form";
import { ReferralPanel } from "./referral-panel";
import { PooledDeposit } from "./pooled-deposit";
import { AccountTabs, type AccountTab } from "./account-tabs";
import { devFaucet } from "./actions";

// Compact tab icons for the account workspace.
const tIcon = "h-4 w-4";
const IconOverview = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={tIcon}><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" /></svg>
);
const IconDeposit = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={tIcon}><path d="M12 3v11m0 0l4-4m-4 4l-4-4M4 21h16" /></svg>
);
const IconSend = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={tIcon}><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
);
const IconWithdraw = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={tIcon}><path d="M12 21V10m0 0l4 4m-4-4l-4 4M4 3h16" /></svg>
);
const IconRefer = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={tIcon}><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" /><path d="M12 8S9.5 3.5 7 5s0 3 5 3zM12 8s2.5-4.5 5-3 0 3-5 3z" /></svg>
);

const WITHDRAWAL_STATUS_LABEL: Record<string, string> = {
  PENDING_APPROVAL: "Awaiting admin review",
  APPROVED: "Approved — queued to send",
  SENDING: "Sending — broadcasting on-chain",
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
      .select(
        "usdt_available::text, usdt_locked::text, usdt_bond::text, usdt_frozen::text",
      )
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("users")
      .select(
        "public_id, reputation_score, completed_trades, completion_rate, is_merchant, kyc_status, account_status, ban_reason",
      )
      .eq("id", user.id)
      .single(),
  ]);

  const available = wallet?.usdt_available ?? "0";
  const locked = wallet?.usdt_locked ?? "0";
  const bond = wallet?.usdt_bond ?? "0";
  const frozen = wallet?.usdt_frozen ?? "0";
  const accountStatus = profile?.account_status ?? "ACTIVE";
  const banReason = profile?.ban_reason ?? null;
  const myPublicId = profile?.public_id ?? "";
  const isFrozen = accountStatus === "FROZEN";
  const isBanned = accountStatus === "BANNED";

  // The admin's runtime switches: live payments (migration 0018), trade policy
  // (0021), and the sweep strategy (0029). The sweep strategy decides the deposit
  // UX — pooled mode uses one shared address + a unique amount, every other
  // strategy gives the user a stable per-user deposit address.
  const [
    livePayments,
    tradePolicy,
    sweepStrategy,
    withdrawalFee,
    transferFee,
    referralBps,
    referralMaxTrades,
    referralStats,
  ] = await Promise.all([
    isLivePaymentsEnabled(),
    getTradePolicy(),
    getSweepStrategy(),
    getWithdrawalFee(),
    getInternalTransferFee(),
    getReferralBps(),
    getReferralMaxTrades(),
    getReferralStats(user.id),
  ]);

  // bps → percent for the referral panel (2000 → "20").
  const referralPercent = (() => {
    const whole = Math.trunc(referralBps / 100);
    const frac = referralBps % 100;
    return frac === 0
      ? String(whole)
      : `${whole}.${String(frac).padStart(2, "0").replace(/0+$/, "")}`;
  })();
  const referralLink = referralStats.code
    ? `${SITE_URL}/signup?ref=${referralStats.code}`
    : "";

  // Per-user deposit address only applies to non-pooled strategies. In pooled
  // mode there is no per-user address, so we don't derive one.
  const depositAddress =
    sweepStrategy === "pooled"
      ? null
      : await ensureDepositAddress(supabase, user.id);
  const withdrawals = await fetchWithdrawalsForUser(supabase, user.id);

  const isMerchant = profile?.is_merchant ?? false;
  const completedTrades = profile?.completed_trades ?? 0;
  const tier = reputationTier({ isMerchant, completedTrades }, tradePolicy);
  const tradeLimit = tradeLimitUsdt({ isMerchant, completedTrades }, tradePolicy);
  const kycStatus = profile?.kyc_status ?? "UNVERIFIED";

  const accountTabs: AccountTab[] = [
    {
      id: "overview",
      label: "Overview",
      icon: IconOverview,
      content: (
        <div className="space-y-4">
          <section className="rounded-card border border-paper-border bg-paper-raised p-5">
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
            minBond={tradePolicy.minMerchantBond}
          />
        </div>
      ),
    },
    {
      id: "deposit",
      label: "Deposit",
      icon: IconDeposit,
      content: (
        <div className="space-y-4">
          {!livePayments && process.env.NODE_ENV !== "production" && (
            <section className="rounded-card border border-amber/40 bg-amber-wash p-5">
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
          {sweepStrategy === "pooled" ? (
            <PooledDeposit
              networkLabel={TRON_NETWORK_LABEL[TRON_NETWORK]}
              minConfirmations={DEPOSIT_MIN_CONFIRMATIONS}
            />
          ) : (
            <section className="rounded-card border border-paper-border bg-paper-raised p-5">
              <h2 className="text-sm font-medium text-ink">Deposit USDT</h2>
              <p className="mt-1 text-xs text-ink-faint">
                Send TRC-20 USDT to this address. It&apos;s credited after{" "}
                {DEPOSIT_MIN_CONFIRMATIONS} confirmations.
              </p>
              <p className="mt-3 break-all rounded-md bg-paper-sunken px-3 py-2 font-amount text-sm text-ink">
                {depositAddress}
              </p>
              <p className="mt-2 text-xs text-amber">
                Only send USDT on {TRON_NETWORK_LABEL[TRON_NETWORK]}. Funds sent on
                any other network or token are unrecoverable.
              </p>
            </section>
          )}
        </div>
      ),
    },
    {
      id: "send",
      label: "Send",
      icon: IconSend,
      content: (
        <InternalTransferForm
          available={available}
          myPublicId={myPublicId}
          fee={transferFee}
        />
      ),
    },
    {
      id: "withdraw",
      label: "Withdraw",
      icon: IconWithdraw,
      content: (
        <div className="space-y-4">
          <WithdrawForm
            available={available}
            networkLabel={TRON_NETWORK_LABEL[TRON_NETWORK]}
            approvalThreshold={WITHDRAWAL_APPROVAL_THRESHOLD}
            fee={withdrawalFee}
          />
          {withdrawals.length > 0 && (
            <section className="rounded-card border border-paper-border bg-paper-raised p-5">
              <h2 className="text-sm font-medium text-ink">Withdrawal history</h2>
              <ul className="mt-3 space-y-2">
                {withdrawals.map((w) => {
                  const sent = fromMicros(
                    toMicros(w.amount_usdt) - toMicros(w.fee_usdt),
                  );
                  return (
                    <li
                      key={w.id}
                      className="rounded-md border border-paper-border bg-paper px-3 py-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                        <span className="font-amount text-sm text-ink">
                          {formatUsdt(sent)} USDT
                        </span>
                        <span className="text-xs text-ink-muted">
                          {WITHDRAWAL_STATUS_LABEL[w.status] ?? w.status}
                        </span>
                      </div>
                      {Number(w.fee_usdt) > 0 && (
                        <p className="mt-0.5 text-xs text-ink-faint">
                          + {formatUsdt(w.fee_usdt)} USDT fee
                        </p>
                      )}
                      {w.status !== "PENDING_APPROVAL" && (
                        <p className="mt-1 break-all font-amount text-xs text-ink-faint">
                          → {w.to_address}
                        </p>
                      )}
                      {w.tx_hash && (
                        <p className="break-all font-amount text-xs text-ink-faint">
                          tx {w.tx_hash}
                        </p>
                      )}
                      {w.failure_reason && (
                        <p className="mt-1 text-xs text-sell">
                          {w.failure_reason}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-ink-faint">
                        {new Date(w.created_at).toLocaleString()}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      ),
    },
    ...(referralStats.code && referralPercent !== "0"
      ? [
          {
            id: "refer",
            label: "Refer & earn",
            icon: IconRefer,
            content: (
              <ReferralPanel
                code={referralStats.code}
                link={referralLink}
                referralCount={referralStats.referralCount}
                totalEarned={referralStats.totalEarned}
                rewardPercent={referralPercent}
                rewardWindow={referralMaxTrades}
              />
            ),
          } satisfies AccountTab,
        ]
      : []),
  ];

  return (
    <>
      <SiteHeader account={accountLabel(user)} active="dashboard" userId={user.id} />
      <main className="animate-rise mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-xl font-semibold text-ink">Account</h1>

      {(isFrozen || isBanned) && (
        <div className="mt-4 rounded-card border border-state-disputed/40 bg-sell-wash p-4">
          <h2 className="text-sm font-semibold text-state-disputed">
            {isBanned
              ? "Account permanently banned"
              : "Account temporarily suspended"}
          </h2>
          <p className="mt-1 text-sm text-state-disputed/90">
            {isBanned
              ? "An admin reviewed a missed release and ruled against you. Your frozen funds were forfeited and trading is disabled. If you believe this was a mistake — for example the buyer marked the order paid without actually paying — you can appeal: contact support and an admin will re-review the chat and payment proof. If the appeal succeeds, your funds are returned and your account is reinstated."
              : "You did not release USDT within the payment window on an order, so your wallet is frozen and trading is suspended pending an admin review. If the admin finds the delay was justified, your funds and account are restored; otherwise the funds are forfeited and the account is banned."}
          </p>
          {banReason && (
            <p className="mt-2 text-xs text-state-disputed/70">{banReason}</p>
          )}
        </div>
      )}

      {kycStatus !== "APPROVED" && !isFrozen && !isBanned && (
        <div className="mt-4 rounded-card border border-amber/40 bg-amber-wash p-4">
          <h2 className="text-sm font-medium text-amber">
            {kycStatus === "PENDING"
              ? "Verification under review"
              : "Verify your identity to start trading"}
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            {kycStatus === "PENDING"
              ? "Our team is reviewing your documents. Trading and withdrawals unlock once you're approved."
              : "Trading, posting ads, and withdrawals are locked until your identity is verified."}
          </p>
          {kycStatus !== "PENDING" && (
            <Link
              href="/verify"
              className="mt-3 inline-block rounded-md bg-amber px-4 py-2 text-sm font-semibold text-paper hover:bg-amber-soft"
            >
              {kycStatus === "REJECTED" ? "Resubmit verification" : "Verify now"}
            </Link>
          )}
        </div>
      )}

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
        {Number(frozen) > 0 && (
          <div className="rounded-card border border-state-disputed/40 bg-sell-wash p-5 sm:col-span-2">
            <p className="text-sm text-state-disputed">Frozen</p>
            <p className="mt-1 font-amount text-2xl text-state-disputed">
              {formatUsdt(frozen)}
            </p>
            <p className="text-xs text-state-disputed/70">
              Suspended pending an admin review of a missed release
            </p>
          </div>
        )}
      </section>

      <AccountTabs tabs={accountTabs} />
      </main>
    </>
  );
}
