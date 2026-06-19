import { describe, it, expect } from "vitest";
import type { KycStatus } from "@/lib/supabase/database.types";

/**
 * The authoritative KYC state machine lives in the migration 0015 SQL functions
 * (kyc_submit / kyc_approve / kyc_reject). This test mirrors their transition
 * rules in a tiny in-memory model — the same convention as orders.test.ts — so
 * the intended behaviour is pinned in fast unit tests:
 *
 *   UNVERIFIED ─submit─▶ PENDING ─approve─▶ APPROVED
 *        ▲                  │
 *        │                  └─reject──▶ REJECTED ─submit─▶ PENDING …
 *        └──────────────────────────────────────────────┘
 *
 * Invariants:
 *   • a user may only submit from UNVERIFIED or REJECTED (one open request)
 *   • only a PENDING submission may be approved or rejected
 *   • APPROVED is terminal for submission; trading is gated on it elsewhere
 */
function submit(status: KycStatus): KycStatus {
  if (status === "APPROVED") throw new Error("already verified");
  if (status === "PENDING") throw new Error("already under review");
  return "PENDING";
}

function approve(status: KycStatus): KycStatus {
  if (status !== "PENDING") throw new Error("not pending");
  return "APPROVED";
}

function reject(status: KycStatus): KycStatus {
  if (status !== "PENDING") throw new Error("not pending");
  return "REJECTED";
}

describe("kyc state machine", () => {
  it("happy path: unverified → pending → approved", () => {
    let s: KycStatus = "UNVERIFIED";
    s = submit(s);
    expect(s).toBe("PENDING");
    s = approve(s);
    expect(s).toBe("APPROVED");
  });

  it("rejected users may resubmit", () => {
    let s: KycStatus = "UNVERIFIED";
    s = submit(s);
    s = reject(s);
    expect(s).toBe("REJECTED");
    s = submit(s); // resubmit allowed
    expect(s).toBe("PENDING");
    s = approve(s);
    expect(s).toBe("APPROVED");
  });

  it("cannot submit while a request is already pending", () => {
    const s = submit("UNVERIFIED");
    expect(() => submit(s)).toThrow(/under review/);
  });

  it("cannot submit once approved", () => {
    expect(() => submit("APPROVED")).toThrow(/already verified/);
  });

  it("only a pending submission can be approved", () => {
    expect(() => approve("UNVERIFIED")).toThrow(/not pending/);
    expect(() => approve("REJECTED")).toThrow(/not pending/);
    expect(() => approve("APPROVED")).toThrow(/not pending/);
  });

  it("only a pending submission can be rejected", () => {
    expect(() => reject("UNVERIFIED")).toThrow(/not pending/);
    expect(() => reject("APPROVED")).toThrow(/not pending/);
  });
});
