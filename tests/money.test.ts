import { describe, it, expect } from "vitest";
import {
  toMicros,
  fromMicros,
  addMicros,
  subMicros,
  takerFeeMicros,
  splitRelease,
  takerFee,
  formatUsdt,
  MICROS_PER_USDT,
  TAKER_FEE_BPS,
} from "@/lib/money";

describe("toMicros", () => {
  it("parses whole and fractional amounts", () => {
    expect(toMicros("0")).toBe(0n);
    expect(toMicros("1")).toBe(1_000_000n);
    expect(toMicros("100.5")).toBe(100_500_000n);
    expect(toMicros("0.000001")).toBe(1n);
    expect(toMicros("999999.999999")).toBe(999_999_999_999n);
  });

  it("tolerates surrounding whitespace", () => {
    expect(toMicros("  42.250000 ")).toBe(42_250_000n);
  });

  it("rejects more than 6 decimal places", () => {
    expect(() => toMicros("1.0000001")).toThrow(/decimal places/);
  });

  it("rejects negative, empty, and non-numeric input", () => {
    expect(() => toMicros("-1")).toThrow();
    expect(() => toMicros("")).toThrow();
    expect(() => toMicros("abc")).toThrow();
    expect(() => toMicros("1.2.3")).toThrow();
    expect(() => toMicros("1e6")).toThrow();
  });
});

describe("fromMicros", () => {
  it("formats canonically, trimming trailing zeros", () => {
    expect(fromMicros(0n)).toBe("0");
    expect(fromMicros(1_000_000n)).toBe("1");
    expect(fromMicros(1n)).toBe("0.000001");
    expect(fromMicros(100_500_000n)).toBe("100.5");
    expect(fromMicros(999_999_999_999n)).toBe("999999.999999");
  });

  it("rejects negative micros", () => {
    expect(() => fromMicros(-1n)).toThrow();
  });

  it("round-trips with toMicros", () => {
    for (const v of ["0", "1", "0.000001", "100.5", "7.123456", "250000"]) {
      expect(fromMicros(toMicros(v))).toBe(v);
    }
  });
});

describe("addMicros / subMicros", () => {
  it("adds exactly", () => {
    expect(addMicros(toMicros("0.1"), toMicros("0.2"))).toBe(toMicros("0.3"));
  });

  it("subtracts exactly", () => {
    expect(subMicros(toMicros("1"), toMicros("0.999999"))).toBe(1n);
  });

  it("refuses to go negative (no overdraft)", () => {
    expect(() => subMicros(toMicros("1"), toMicros("1.000001"))).toThrow(
      /Insufficient/,
    );
  });
});

describe("takerFeeMicros (0.25%, half-up)", () => {
  it("computes the standard fee", () => {
    // 100 USDT * 0.25% = 0.25 USDT
    expect(takerFeeMicros(toMicros("100"))).toBe(toMicros("0.25"));
    // 40 USDT * 0.25% = 0.1 USDT
    expect(takerFeeMicros(toMicros("40"))).toBe(toMicros("0.1"));
  });

  it("rounds half-up at the micro boundary", () => {
    // 0.000001 * 25 / 10000 = 0.0000000025 -> rounds to 0 micros
    expect(takerFeeMicros(1n)).toBe(0n);
    // 0.2 USDT * 0.25% = 0.0005 -> exactly 500 micros, no rounding needed
    expect(takerFeeMicros(toMicros("0.2"))).toBe(500n);
    // choose an amount whose fee lands on x.5 micros: amount*25/10000 = k.5
    // 200000 micros (0.2) handled above; use 4000 micros: 4000*25=100000;
    // 100000/10000 = 10 exactly. Use 4200 micros: 4200*25=105000; /10000 = 10.5 -> 11
    expect(takerFeeMicros(4200n)).toBe(11n);
  });

  it("honours a custom bps", () => {
    expect(takerFeeMicros(toMicros("100"), 0n)).toBe(0n);
    expect(takerFeeMicros(toMicros("100"), 100n)).toBe(toMicros("1")); // 1%
  });
});

describe("splitRelease conservation", () => {
  it("fee + net always equals the amount", () => {
    const amounts = [
      "0.000001",
      "0.5",
      "1",
      "33.333333",
      "100",
      "12345.678901",
      "999999.999999",
    ];
    for (const a of amounts) {
      const amt = toMicros(a);
      const { feeMicros, netMicros } = splitRelease(amt);
      expect(feeMicros + netMicros).toBe(amt);
      expect(feeMicros).toBeGreaterThanOrEqual(0n);
      expect(netMicros).toBeGreaterThanOrEqual(0n);
    }
  });

  it("matches the spec example: lock 100, buyer gets 99.75, fee 0.25", () => {
    const { feeMicros, netMicros } = splitRelease(toMicros("100"));
    expect(fromMicros(feeMicros)).toBe("0.25");
    expect(fromMicros(netMicros)).toBe("99.75");
  });

  it("rejects non-positive amounts", () => {
    expect(() => splitRelease(0n)).toThrow();
  });
});

describe("escrow wallet transition conservation", () => {
  // Simulate the balance moves the SQL primitives perform, asserting that the
  // total USDT across all parties is conserved at every step.
  it("lock -> release conserves total across seller, buyer, platform", () => {
    let sellerAvail = toMicros("500");
    let sellerLocked = 0n;
    let buyerAvail = toMicros("10");
    let platformAvail = 0n;
    const total = () =>
      sellerAvail + sellerLocked + buyerAvail + platformAvail;
    const before = total();

    const amount = toMicros("100");
    // LOCK: seller available -> locked
    sellerAvail = subMicros(sellerAvail, amount);
    sellerLocked = addMicros(sellerLocked, amount);
    expect(total()).toBe(before);

    // RELEASE: seller locked out; buyer gets net; platform gets fee
    const { feeMicros, netMicros } = splitRelease(amount);
    sellerLocked = subMicros(sellerLocked, amount);
    buyerAvail = addMicros(buyerAvail, netMicros);
    platformAvail = addMicros(platformAvail, feeMicros);
    expect(total()).toBe(before);
    expect(sellerLocked).toBe(0n);
    expect(buyerAvail).toBe(toMicros("109.75"));
    expect(platformAvail).toBe(toMicros("0.25"));
  });

  it("lock -> unlock (cancel) returns funds with total conserved", () => {
    let avail = toMicros("250");
    let locked = 0n;
    const before = avail + locked;
    const amount = toMicros("80");
    avail = subMicros(avail, amount);
    locked = addMicros(locked, amount);
    // UNLOCK
    locked = subMicros(locked, amount);
    avail = addMicros(avail, amount);
    expect(avail + locked).toBe(before);
    expect(avail).toBe(toMicros("250"));
    expect(locked).toBe(0n);
  });
});

describe("string-level helpers", () => {
  it("takerFee returns a decimal string", () => {
    expect(takerFee("100")).toBe("0.25");
  });

  it("formatUsdt groups thousands and keeps >= 2 decimals", () => {
    expect(formatUsdt("1234567.5")).toBe("1,234,567.50");
    expect(formatUsdt("0")).toBe("0.00");
    expect(formatUsdt("99.75")).toBe("99.75");
    expect(formatUsdt("1.234567")).toBe("1.234567");
  });
});

describe("constants", () => {
  it("uses 6-decimal scale and 25 bps", () => {
    expect(MICROS_PER_USDT).toBe(1_000_000n);
    expect(TAKER_FEE_BPS).toBe(25n);
  });
});
