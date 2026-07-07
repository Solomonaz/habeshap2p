"use client";

import { useState, useTransition } from "react";
import type { AccountSearchResult } from "@/lib/accounts";
import {
  searchAccountsAction,
  banAccountAction,
  unbanAccountAction,
} from "../actions";

/**
 * Admin account management: search any account by email / name / HabeshaP2P ID,
 * then ban (freezes funds + hides the account from everyone) or unban (restores
 * everything). Banning re-verifies the admin's own password as a safety gate.
 * No data is ever deleted — ban/unban only flip a status flag.
 */
export function AccountManager() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AccountSearchResult[] | null>(null);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const [banFor, setBanFor] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function runSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchErr(null);
    setBanFor(null);
    start(async () => {
      const r = await searchAccountsAction(query);
      if (r.error) {
        setSearchErr(r.error);
        setResults([]);
      } else {
        setResults(r.results ?? []);
      }
    });
  }

  function patch(userId: string, next: Partial<AccountSearchResult>) {
    setResults(
      (prev) =>
        prev?.map((a) => (a.userId === userId ? { ...a, ...next } : a)) ?? null,
    );
  }

  async function confirmBan(userId: string) {
    setActionErr(null);
    setBusyId(userId);
    const r = await banAccountAction(userId, password, reason);
    setBusyId(null);
    if (r.error) {
      setActionErr(r.error);
      return;
    }
    patch(userId, {
      accountStatus: "BANNED",
      banReason: reason.trim() || "Banned by an administrator",
    });
    setBanFor(null);
    setPassword("");
    setReason("");
  }

  async function doUnban(userId: string) {
    setActionErr(null);
    setBusyId(userId);
    const r = await unbanAccountAction(userId);
    setBusyId(null);
    if (r.error) {
      setActionErr(r.error);
      return;
    }
    patch(userId, { accountStatus: "ACTIVE", banReason: null });
  }

  return (
    <section className="rounded-card border border-paper-border bg-paper-raised p-5">
      <h2 className="text-sm font-semibold text-ink">Account management</h2>
      <p className="mt-1 text-xs text-ink-faint">
        Search by email, name, or HabeshaP2P ID. <b>Banning</b> freezes the
        account&apos;s funds and hides it (ads, profile, presence) from other
        users — nothing is deleted. <b>Unbanning</b> restores everything.
      </p>

      <form onSubmit={runSearch} className="mt-4 flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Email, name, or UID (e.g. 98058475)"
          className="w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-amber focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending || query.trim().length < 2}
          className="shrink-0 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Searching…" : "Search"}
        </button>
      </form>

      {searchErr && (
        <p className="mt-3 rounded-md border border-sell/40 bg-sell-wash px-3 py-2 text-sm text-sell">
          {searchErr}
        </p>
      )}
      {results && results.length === 0 && !searchErr && (
        <p className="mt-3 text-sm text-ink-muted">No accounts found.</p>
      )}

      {results && results.length > 0 && (
        <ul className="mt-4 space-y-2">
          {results.map((a) => {
            const banned = a.accountStatus === "BANNED";
            const forfeited = Number(a.forfeitedUsdt) > 0;
            return (
              <li
                key={a.userId}
                className="rounded-md border border-paper-border bg-paper p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-ink">
                      <span className="truncate">{a.fullName ?? "—"}</span>
                      <StatusBadge status={a.accountStatus} />
                      {a.isAdmin && (
                        <span className="rounded bg-amber-wash px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber">
                          Admin
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-ink-faint">{a.email}</p>
                    <p className="font-amount text-xs text-ink-faint">
                      UID {a.publicId ?? "—"}
                    </p>
                    {banned && a.banReason && (
                      <p className="mt-1 text-xs text-sell">{a.banReason}</p>
                    )}
                  </div>

                  <div className="shrink-0">
                    {a.isAdmin ? (
                      <span className="text-xs text-ink-faint">Protected</span>
                    ) : a.accountStatus === "FROZEN" ? (
                      <span className="text-xs text-ink-faint">
                        Under review
                      </span>
                    ) : banned && forfeited ? (
                      <span className="text-xs text-ink-faint">
                        Forfeited funds — reinstate below
                      </span>
                    ) : banned ? (
                      <button
                        type="button"
                        onClick={() => doUnban(a.userId)}
                        disabled={busyId === a.userId}
                        className="rounded-md border border-buy/50 bg-buy-wash px-3 py-1.5 text-xs font-semibold text-buy hover:opacity-90 disabled:opacity-50"
                      >
                        {busyId === a.userId ? "…" : "Unban"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setActionErr(null);
                          setPassword("");
                          setReason("");
                          setBanFor(banFor === a.userId ? null : a.userId);
                        }}
                        className="rounded-md border border-sell/50 bg-sell-wash px-3 py-1.5 text-xs font-semibold text-sell hover:opacity-90"
                      >
                        Ban
                      </button>
                    )}
                  </div>
                </div>

                {banFor === a.userId && (
                  <div className="mt-3 rounded-md border border-sell/40 bg-sell-wash p-3">
                    <p className="text-xs font-medium text-sell">
                      Confirm ban — enter your own admin password. This freezes
                      their funds and hides the account until you unban it.
                    </p>
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Your admin password"
                      className="mt-2 w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-amber focus:outline-none"
                    />
                    <input
                      type="text"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Reason (optional, shown to the user)"
                      className="mt-2 w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-amber focus:outline-none"
                    />
                    {actionErr && (
                      <p className="mt-2 text-xs text-sell">{actionErr}</p>
                    )}
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => confirmBan(a.userId)}
                        disabled={busyId === a.userId || password.length === 0}
                        className="rounded-md bg-sell px-4 py-1.5 text-xs font-semibold text-paper hover:opacity-90 disabled:opacity-50"
                      >
                        {busyId === a.userId ? "Banning…" : "Confirm ban"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setBanFor(null);
                          setActionErr(null);
                          setPassword("");
                        }}
                        className="rounded-md border border-paper-border px-3 py-1.5 text-xs text-ink-soft hover:bg-paper-sunken"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "BANNED"
      ? "bg-sell-wash text-sell"
      : status === "FROZEN"
        ? "bg-amber-wash text-amber"
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
