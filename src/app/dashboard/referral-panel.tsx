import { CopyButton } from "@/components/copy-button";
import { formatUsdt } from "@/lib/money";

/**
 * "Refer & earn" panel (migration 0050). Shows the user's invite link (their
 * public_id as a ?ref code), how many people they've referred, and how much
 * they've earned. Server component — the only interactive bit is the CopyButton.
 * Hidden entirely if the program is off (rewardPercent "0") or the user has no
 * code yet.
 */
export function ReferralPanel({
  code,
  link,
  referralCount,
  totalEarned,
  rewardPercent,
  rewardWindow,
}: {
  code: string | null;
  link: string;
  referralCount: number;
  totalEarned: string;
  rewardPercent: string;
  /** How many of a referee's first trades earn a reward; 0 = every trade. */
  rewardWindow: number;
}) {
  if (!code || rewardPercent === "0") return null;
  const windowText =
    rewardWindow > 0
      ? `each invitee's first ${rewardWindow} trade${
          rewardWindow === 1 ? "" : "s"
        }`
      : "every trade your invitees make";

  return (
    <section className="mt-4 overflow-hidden rounded-card border border-amber/30 bg-gradient-to-br from-amber-wash to-paper-raised p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber/15 text-amber">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="8" width="18" height="4" rx="1" />
            <path d="M12 8v13M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
            <path d="M12 8S9.5 3.5 7 5s0 3 5 3zM12 8s2.5-4.5 5-3-0 3-5 3z" />
          </svg>
        </span>
        <div>
          <h2 className="text-sm font-semibold text-ink">Refer &amp; earn</h2>
          <p className="text-xs text-ink-soft">
            Earn{" "}
            <span className="font-semibold text-amber">{rewardPercent}%</span> of
            the trade fee on {windowText} — paid to your balance automatically.
          </p>
        </div>
      </div>

      <div className="mt-4">
        <span className="text-xs font-medium text-ink-soft">
          Your invite link
        </span>
        <div className="mt-1 flex items-center gap-2">
          <input
            readOnly
            value={link}
            className="w-full truncate rounded-md border border-paper-border bg-paper px-3 py-2 font-amount text-xs text-ink focus:outline-none"
          />
          <CopyButton value={link} ariaLabel="Copy invite link" />
        </div>
        <p className="mt-1 text-xs text-ink-faint">
          Or share your HabeshaP2P ID:{" "}
          <span className="font-amount text-ink-soft">#{code}</span>
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-md border border-paper-border bg-paper px-3 py-2.5">
          <p className="text-xs text-ink-muted">Referrals</p>
          <p className="mt-0.5 font-amount text-xl font-semibold text-ink">
            {referralCount}
          </p>
        </div>
        <div className="rounded-md border border-paper-border bg-paper px-3 py-2.5">
          <p className="text-xs text-ink-muted">Earned</p>
          <p className="mt-0.5 font-amount text-xl font-semibold text-buy">
            {formatUsdt(totalEarned)}{" "}
            <span className="text-sm font-normal text-ink-faint">USDT</span>
          </p>
        </div>
      </div>
    </section>
  );
}
