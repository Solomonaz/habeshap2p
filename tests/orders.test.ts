import { describe, it, expect } from "vitest";
import {
  toMicros,
  fromMicros,
  addMicros,
  subMicros,
  splitRelease,
} from "@/lib/money";
import {
  tradeLimitUsdt,
  reputationTier,
  MIN_MERCHANT_BOND,
} from "@/lib/reputation";
import { needsApproval } from "@/lib/chain/config";
import { summarizeReserves } from "@/lib/platform";

/**
 * These tests model the exact balance moves the migration 0007 escrow functions
 * perform, so the money invariants are pinned in fast unit tests even though the
 * authoritative logic lives in Postgres. The single invariant that must NEVER
 * break: total USDT across every seller wallet (available + locked), every buyer
 * wallet, and the platform fee account is conserved through every transition.
 */

// A tiny in-memory mirror of the wallets + platform_account tables.
class Ledger {
  available = new Map<string, bigint>();
  locked = new Map<string, bigint>();
  bond = new Map<string, bigint>();
  withdrawLocked = new Map<string, bigint>();
  platformFees = 0n;

  credit(user: string, amount: bigint) {
    this.available.set(user, addMicros(this.avail(user), amount));
  }
  avail(user: string) {
    return this.available.get(user) ?? 0n;
  }
  lockedOf(user: string) {
    return this.locked.get(user) ?? 0n;
  }
  bondOf(user: string) {
    return this.bond.get(user) ?? 0n;
  }
  withdrawLockedOf(user: string) {
    return this.withdrawLocked.get(user) ?? 0n;
  }

  // credit_deposit: a confirmed on-chain deposit MINTS internal balance.
  creditDeposit(user: string, amount: bigint) {
    this.available.set(user, addMicros(this.avail(user), amount));
  }
  // withdrawal_request: available -> usdt_withdraw_locked (held, not yet burned)
  requestWithdrawal(user: string, amount: bigint) {
    this.available.set(user, subMicros(this.avail(user), amount));
    this.withdrawLocked.set(
      user,
      addMicros(this.withdrawLockedOf(user), amount),
    );
  }
  // withdrawal_reject / withdrawal_mark_failed: refund the hold -> available
  refundWithdrawal(user: string, amount: bigint) {
    this.withdrawLocked.set(
      user,
      subMicros(this.withdrawLockedOf(user), amount),
    );
    this.available.set(user, addMicros(this.avail(user), amount));
  }
  // withdrawal_mark_sent: broadcast BURNS the held funds (leaves the system).
  broadcastWithdrawal(user: string, amount: bigint) {
    this.withdrawLocked.set(
      user,
      subMicros(this.withdrawLockedOf(user), amount),
    );
  }

  // merchant_post_bond: available -> bond (collateral held in escrow)
  postBond(user: string, amount: bigint) {
    this.available.set(user, subMicros(this.avail(user), amount));
    this.bond.set(user, addMicros(this.bondOf(user), amount));
  }
  // merchant_release_bond: the whole bond -> available
  releaseBond(user: string) {
    const held = this.bondOf(user);
    this.bond.set(user, 0n);
    this.available.set(user, addMicros(this.avail(user), held));
  }

  // order_create -> ledger_lock: seller available -> locked
  lock(seller: string, amount: bigint) {
    this.available.set(seller, subMicros(this.avail(seller), amount));
    this.locked.set(seller, addMicros(this.lockedOf(seller), amount));
  }

  // order_release: seller locked out; buyer gets net; platform gets the fee
  release(seller: string, buyer: string, amount: bigint) {
    const { feeMicros, netMicros } = splitRelease(amount);
    this.locked.set(seller, subMicros(this.lockedOf(seller), amount));
    this.available.set(buyer, addMicros(this.avail(buyer), netMicros));
    this.platformFees = addMicros(this.platformFees, feeMicros);
    return { feeMicros, netMicros };
  }

  // order_cancel / order_expire_unpaid -> ledger_unlock: locked -> available
  unlock(seller: string, amount: bigint) {
    this.locked.set(seller, subMicros(this.lockedOf(seller), amount));
    this.available.set(seller, addMicros(this.avail(seller), amount));
  }

  // dispute_resolve FAVOUR_BUYER: escrow -> buyer in FULL (no fee skimmed)
  resolveFavourBuyer(seller: string, buyer: string, amount: bigint) {
    this.locked.set(seller, subMicros(this.lockedOf(seller), amount));
    this.available.set(buyer, addMicros(this.avail(buyer), amount));
  }
  // dispute_resolve FAVOUR_SELLER is identical to a cancel/refund: unlock().

  total() {
    let sum = this.platformFees;
    for (const v of this.available.values()) sum += v;
    for (const v of this.locked.values()) sum += v;
    for (const v of this.bond.values()) sum += v;
    for (const v of this.withdrawLocked.values()) sum += v;
    return sum;
  }
}

describe("order release scenario", () => {
  it("conserves total through lock -> mark paid -> release", () => {
    const led = new Ledger();
    led.credit("seller", toMicros("500"));
    led.credit("buyer", toMicros("0"));
    const before = led.total();

    const amount = toMicros("100");
    led.lock("seller", amount);
    expect(led.total()).toBe(before);
    expect(led.lockedOf("seller")).toBe(amount);

    // mark paid moves NO money (rule #1) — nothing to assert but the invariant.
    expect(led.total()).toBe(before);

    const { feeMicros, netMicros } = led.release("seller", "buyer", amount);
    expect(led.total()).toBe(before);
    expect(led.lockedOf("seller")).toBe(0n);
    expect(led.avail("buyer")).toBe(netMicros);
    expect(led.platformFees).toBe(feeMicros);
    // spec example: 100 -> buyer 99.75, platform 0.25
    expect(fromMicros(netMicros)).toBe("99.75");
    expect(fromMicros(feeMicros)).toBe("0.25");
  });

  it("accumulates platform fees across many trades, total conserved", () => {
    const led = new Ledger();
    led.credit("seller", toMicros("1000000"));
    const before = led.total();

    let expectedFees = 0n;
    for (const a of ["0.5", "1", "33.333333", "100", "12345.678901"]) {
      const amount = toMicros(a);
      led.lock("seller", amount);
      const { feeMicros } = led.release("seller", "buyer", amount);
      expectedFees += feeMicros;
      expect(led.total()).toBe(before);
    }
    expect(led.platformFees).toBe(expectedFees);
    expect(led.lockedOf("seller")).toBe(0n);
  });

  it("conserves total through lock -> cancel (timer expiry returns funds)", () => {
    const led = new Ledger();
    led.credit("seller", toMicros("250"));
    const before = led.total();

    const amount = toMicros("80");
    led.lock("seller", amount);
    expect(led.lockedOf("seller")).toBe(amount);

    led.unlock("seller", amount);
    expect(led.total()).toBe(before);
    expect(led.lockedOf("seller")).toBe(0n);
    expect(led.avail("seller")).toBe(toMicros("250"));
    expect(led.platformFees).toBe(0n);
  });

  it("cannot release more than was locked (no negative locked balance)", () => {
    const led = new Ledger();
    led.credit("seller", toMicros("10"));
    led.lock("seller", toMicros("10"));
    // Releasing twice would drive locked negative; subMicros guards it.
    led.release("seller", "buyer", toMicros("10"));
    expect(() => led.release("seller", "buyer", toMicros("10"))).toThrow(
      /Insufficient/,
    );
  });
});

describe("dispute resolution scenario (migration 0010)", () => {
  it("FAVOUR_BUYER releases the FULL amount to the buyer, no fee", () => {
    const led = new Ledger();
    led.credit("seller", toMicros("300"));
    const before = led.total();

    const amount = toMicros("120");
    led.lock("seller", amount);
    // The order would be PAID -> DISPUTED here; no money moves on those.
    led.resolveFavourBuyer("seller", "buyer", amount);

    expect(led.total()).toBe(before);
    expect(led.lockedOf("seller")).toBe(0n);
    // Buyer gets the whole 120 — a dispute ruling charges no taker fee.
    expect(led.avail("buyer")).toBe(toMicros("120"));
    expect(fromMicros(led.avail("buyer"))).toBe("120");
    expect(led.platformFees).toBe(0n);
  });

  it("FAVOUR_SELLER returns the escrow to the seller (like a cancel)", () => {
    const led = new Ledger();
    led.credit("seller", toMicros("300"));
    const before = led.total();

    const amount = toMicros("120");
    led.lock("seller", amount);
    led.unlock("seller", amount);

    expect(led.total()).toBe(before);
    expect(led.lockedOf("seller")).toBe(0n);
    expect(led.avail("seller")).toBe(toMicros("300"));
    expect(led.avail("buyer")).toBe(0n);
    expect(led.platformFees).toBe(0n);
  });
});

describe("amount_etb derivation (round to 2dp)", () => {
  // Mirrors order_create's `round(p_amount_usdt * v_rate, 2)`. ETB is fiat
  // display math only — never used for escrow — so Number is acceptable here.
  function amountEtb(amountUsdt: string, rate: string): string {
    return (Math.round(Number(amountUsdt) * Number(rate) * 100) / 100).toFixed(
      2,
    );
  }

  it("computes the fiat leg at the quoted rate", () => {
    expect(amountEtb("100", "165.50")).toBe("16550.00");
    expect(amountEtb("33.333333", "160")).toBe("5333.33");
    expect(amountEtb("1", "165.4321")).toBe("165.43");
  });
});

describe("merchant bond (migration 0011) conserves total", () => {
  it("post then release a bond returns the wallet to its starting state", () => {
    const led = new Ledger();
    led.credit("merchant", toMicros("1000"));
    const before = led.total();

    const amount = toMicros(String(MIN_MERCHANT_BOND)); // 500
    led.postBond("merchant", amount);
    expect(led.total()).toBe(before); // money only moved buckets
    expect(led.bondOf("merchant")).toBe(amount);
    expect(led.avail("merchant")).toBe(toMicros("500"));

    led.releaseBond("merchant");
    expect(led.total()).toBe(before);
    expect(led.bondOf("merchant")).toBe(0n);
    expect(led.avail("merchant")).toBe(toMicros("1000"));
  });

  it("cannot bond more than available (no negative available balance)", () => {
    const led = new Ledger();
    led.credit("merchant", toMicros("100"));
    expect(() => led.postBond("merchant", toMicros("500"))).toThrow(
      /Insufficient/,
    );
  });

  it("a bonded merchant can still trade — bond stays put through a release", () => {
    const led = new Ledger();
    led.credit("seller", toMicros("1000"));
    const before = led.total();

    led.postBond("seller", toMicros("500"));
    // Trade the remaining available balance while bonded.
    const amount = toMicros("200");
    led.lock("seller", amount);
    led.release("seller", "buyer", amount);

    expect(led.total()).toBe(before);
    expect(led.bondOf("seller")).toBe(toMicros("500")); // untouched by the trade
  });
});

describe("trade limits + reputation tiers (mirrors _trade_limit_usdt)", () => {
  it("caps a brand-new account at 100 USDT", () => {
    expect(tradeLimitUsdt({ isMerchant: false, completedTrades: 0 })).toBe(100);
    expect(reputationTier({ isMerchant: false, completedTrades: 0 })).toBe(
      "NEW",
    );
  });

  it("lifts the cap to 1,000 after the first completed trade", () => {
    expect(tradeLimitUsdt({ isMerchant: false, completedTrades: 1 })).toBe(1000);
    expect(tradeLimitUsdt({ isMerchant: false, completedTrades: 9 })).toBe(1000);
    expect(reputationTier({ isMerchant: false, completedTrades: 5 })).toBe(
      "ACTIVE",
    );
  });

  it("lifts the cap to 10,000 at 10 completed trades", () => {
    expect(tradeLimitUsdt({ isMerchant: false, completedTrades: 10 })).toBe(
      10000,
    );
    expect(reputationTier({ isMerchant: false, completedTrades: 10 })).toBe(
      "ESTABLISHED",
    );
  });

  it("a bonded merchant is uncapped regardless of trade count", () => {
    expect(tradeLimitUsdt({ isMerchant: true, completedTrades: 0 })).toBeNull();
    expect(tradeLimitUsdt({ isMerchant: true, completedTrades: 99 })).toBeNull();
    expect(reputationTier({ isMerchant: true, completedTrades: 0 })).toBe(
      "MERCHANT",
    );
  });
});

describe("withdrawal hold (migration 0012)", () => {
  it("request then reject returns the wallet to its starting state", () => {
    const led = new Ledger();
    led.credit("user", toMicros("1000"));
    const before = led.total();

    const amount = toMicros("300");
    led.requestWithdrawal("user", amount);
    // Money only moved buckets — nothing minted or burned yet.
    expect(led.total()).toBe(before);
    expect(led.withdrawLockedOf("user")).toBe(amount);
    expect(led.avail("user")).toBe(toMicros("700"));

    // Admin rejects (or the broadcast fails): the hold is refunded.
    led.refundWithdrawal("user", amount);
    expect(led.total()).toBe(before);
    expect(led.withdrawLockedOf("user")).toBe(0n);
    expect(led.avail("user")).toBe(toMicros("1000"));
  });

  it("broadcasting a withdrawal BURNS the held funds (total drops)", () => {
    const led = new Ledger();
    led.credit("user", toMicros("1000"));
    const before = led.total();

    const amount = toMicros("300");
    led.requestWithdrawal("user", amount);
    expect(led.total()).toBe(before); // held, still in-system

    led.broadcastWithdrawal("user", amount);
    // The only operations that change total are deposits (mint) and broadcast
    // withdrawals (burn). Here the burn lowers it by exactly the amount sent.
    expect(led.total()).toBe(before - amount);
    expect(led.withdrawLockedOf("user")).toBe(0n);
    expect(led.avail("user")).toBe(toMicros("700"));
  });

  it("a deposit MINTS balance (total rises by exactly the credit)", () => {
    const led = new Ledger();
    led.credit("user", toMicros("50"));
    const before = led.total();

    led.creditDeposit("user", toMicros("250"));
    expect(led.total()).toBe(before + toMicros("250"));
    expect(led.avail("user")).toBe(toMicros("300"));
  });

  it("cannot withdraw more than available (no negative available)", () => {
    const led = new Ledger();
    led.credit("user", toMicros("100"));
    expect(() => led.requestWithdrawal("user", toMicros("500"))).toThrow(
      /Insufficient/,
    );
  });

  it("a full deposit -> withdraw round trip nets to zero internal balance", () => {
    const led = new Ledger();
    const start = led.total(); // 0
    led.creditDeposit("user", toMicros("400"));
    led.requestWithdrawal("user", toMicros("400"));
    led.broadcastWithdrawal("user", toMicros("400"));
    // Minted 400 on deposit, burned 400 on broadcast — back to the start.
    expect(led.total()).toBe(start);
    expect(led.avail("user")).toBe(0n);
    expect(led.withdrawLockedOf("user")).toBe(0n);
  });
});

describe("withdrawal approval threshold (rule #6, mirrors withdrawal_request)", () => {
  it("amounts at or above 500 USDT need admin approval", () => {
    expect(needsApproval(500)).toBe(true);
    expect(needsApproval(500.000001)).toBe(true);
    expect(needsApproval(10000)).toBe(true);
  });

  it("amounts below the threshold are auto-approved", () => {
    expect(needsApproval(499.999999)).toBe(false);
    expect(needsApproval(100)).toBe(false);
    expect(needsApproval(0.5)).toBe(false);
  });

  it("respects an explicit threshold override", () => {
    expect(needsApproval(50, 25)).toBe(true);
    expect(needsApproval(20, 25)).toBe(false);
  });
});

describe("platform ops reserve summary (Phase 8)", () => {
  it("sums the buckets in exact micros and reconciles a consistent snapshot", () => {
    const stats = {
      available: "1000.5",
      locked: "250",
      bond: "500",
      withdraw_locked: "33.333333",
      platform_fees: "12.25",
      // What SQL would report — the sums of the above.
      liabilities: "1783.833333", // 1000.5 + 250 + 500 + 33.333333
      total_supply: "1796.083333", // + 12.25 fees
    };
    const r = summarizeReserves(stats);
    expect(r.liabilitiesMicros).toBe(toMicros("1783.833333"));
    expect(r.platformFeesMicros).toBe(toMicros("12.25"));
    expect(r.totalSupplyMicros).toBe(toMicros("1796.083333"));
    expect(r.reconciles).toBe(true);
  });

  it("flags a snapshot whose reported totals don't match the buckets", () => {
    const stats = {
      available: "100",
      locked: "0",
      bond: "0",
      withdraw_locked: "0",
      platform_fees: "0",
      liabilities: "999", // wrong on purpose
      total_supply: "999",
    };
    expect(summarizeReserves(stats).reconciles).toBe(false);
  });
});
