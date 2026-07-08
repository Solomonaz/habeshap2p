"use client";

import { useState } from "react";
import type { AccountRow } from "@/lib/accounts";
import { banAccountAction, unbanAccountAction } from "../actions";

/**
 * Admin account table with per-row ban/unban. Banning opens a modal that
 * re-verifies the admin's own password before freezing + hiding the account;
 * unbanning restores it. Rows are seeded from the server (paginated) and updated
 * in place after an action so the status flips without a full reload.
 */
export function AccountsTable({ rows: initial }: { rows: AccountRow[] }) {
  const [rows, setRows] = useState(initial);
  const [banning, setBanning] = useState<AccountRow | null>(null);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [modalErr, setModalErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<{ id: string; msg: string } | null>(null);

  const patch = (id: string, next: Partial<AccountRow>) =>
    setRows((prev) => prev.map((r) => (r.userId === id ? { ...r, ...next } : r)));

  async function confirmBan() {
    if (!banning) return;
    setModalErr(null);
    setBusy(true);
    const r = await banAccountAction(banning.userId, password, reason);
    setBusy(false);
    if (r.error) {
      setModalErr(r.error);
      return;
    }
    patch(banning.userId, {
      accountStatus: "BANNED",
      banReason: reason.trim() || "Banned by an administrator",
    });
    closeModal();
  }

  async function unban(a: AccountRow) {
    setRowErr(null);
    setRowBusy(a.userId);
    const r = await unbanAccountAction(a.userId);
    setRowBusy(null);
    if (r.error) {
      setRowErr({ id: a.userId, msg: r.error });
      return;
    }
    patch(a.userId, { accountStatus: "ACTIVE", banReason: null });
  }

  function closeModal() {
    setBanning(null);
    setPassword("");
    setReason("");
    setModalErr(null);
  }

  return (
    <>
      <div className="overflow-x-auto rounded-card border border-paper-border">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-paper-border bg-paper-sunken/50 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5">User</th>
              <th className="px-4 py-2.5">UID</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">KYC</th>
              <th className="px-4 py-2.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-sm text-ink-muted"
                >
                  No accounts.
                </td>
              </tr>
            ) : (
              rows.map((a) => {
                const banned = a.accountStatus === "BANNED";
                const forfeited = Number(a.forfeitedUsdt) > 0;
                return (
                  <tr
                    key={a.userId}
                    className="border-b border-paper-border/60 last:border-0 hover:bg-paper-sunken/30"
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">
                        {a.fullName ?? "—"}
                        {a.isAdmin && (
                          <span className="ml-2 rounded bg-amber-wash px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber">
                            Admin
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-ink-faint">
                        {a.email ?? "—"}
                      </p>
                      {banned && a.banReason && (
                        <p className="mt-0.5 text-xs text-sell">{a.banReason}</p>
                      )}
                      {rowErr?.id === a.userId && (
                        <p className="mt-0.5 text-xs text-sell">{rowErr.msg}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 font-amount text-xs text-ink-soft">
                      {a.publicId ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={displayStatus(a)} />
                    </td>
                    <td className="px-4 py-3">
                      <KycBadge status={a.kycStatus} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {a.isAdmin ? (
                        <span className="text-xs text-ink-faint">Protected</span>
                      ) : a.accountStatus === "FROZEN" ? (
                        <span className="text-xs text-ink-faint">
                          Under review
                        </span>
                      ) : banned && forfeited ? (
                        <span className="text-xs text-ink-faint">
                          Reinstate below
                        </span>
                      ) : banned ? (
                        <button
                          type="button"
                          onClick={() => unban(a)}
                          disabled={rowBusy === a.userId}
                          className="rounded-md border border-buy/50 bg-buy-wash px-3 py-1.5 text-xs font-semibold text-buy hover:opacity-90 disabled:opacity-50"
                        >
                          {rowBusy === a.userId ? "…" : "Unban"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setRowErr(null);
                            setBanning(a);
                          }}
                          className="rounded-md border border-sell/50 bg-sell-wash px-3 py-1.5 text-xs font-semibold text-sell hover:opacity-90"
                        >
                          Ban
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {banning && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={closeModal}
        >
          <div
            className="w-full max-w-sm rounded-card border border-paper-border bg-paper-raised p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-ink">
              Ban {banning.fullName ?? banning.email ?? "this account"}?
            </h3>
            <p className="mt-1 text-xs text-ink-faint">
              This freezes their funds and hides the account (ads, profile,
              presence) from other users. Nothing is deleted — you can unban to
              restore everything. Enter your own admin password to confirm.
            </p>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your admin password"
              className="mt-3 w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-amber focus:outline-none"
            />
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional, shown to the user)"
              className="mt-2 w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-amber focus:outline-none"
            />
            {modalErr && <p className="mt-2 text-xs text-sell">{modalErr}</p>}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md border border-paper-border px-3 py-1.5 text-xs text-ink-soft hover:bg-paper-sunken"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmBan}
                disabled={busy || password.length === 0}
                className="rounded-md bg-sell px-4 py-1.5 text-xs font-semibold text-paper hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Banning…" : "Confirm ban"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Display status shown to the admin: a registered-but-email-unconfirmed account
 * is "INACTIVE" (they can't sign in), taking priority over ACTIVE but not over a
 * ban/freeze.
 */
function displayStatus(a: AccountRow): string {
  if (a.accountStatus === "BANNED") return "BANNED";
  if (a.accountStatus === "FROZEN") return "FROZEN";
  if (!a.emailConfirmed) return "INACTIVE";
  return "ACTIVE";
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "BANNED"
      ? "bg-sell-wash text-sell"
      : status === "FROZEN"
        ? "bg-amber-wash text-amber"
        : status === "INACTIVE"
          ? "bg-paper-sunken text-ink-faint"
          : "bg-buy-wash text-buy";
  return (
    <span
      className={
        "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
        cls
      }
    >
      {status}
    </span>
  );
}

function KycBadge({ status }: { status: string }) {
  const v =
    status === "APPROVED"
      ? { label: "Verified", cls: "bg-buy-wash text-buy" }
      : status === "PENDING"
        ? { label: "Pending", cls: "bg-amber-wash text-amber" }
        : status === "REJECTED"
          ? { label: "Rejected", cls: "bg-sell-wash text-sell" }
          : { label: "Unverified", cls: "bg-paper-sunken text-ink-faint" };
  return (
    <span
      className={
        "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
        v.cls
      }
    >
      {v.label}
    </span>
  );
}
