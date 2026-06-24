import { describe, it, expect } from "vitest";
import {
  isNonNegativeDecimal,
  maxEtbForBalance,
  sellMaxExceedsBalance,
} from "@/lib/ad-capacity";

describe("isNonNegativeDecimal", () => {
  it("accepts whole and fractional non-negative decimals", () => {
    expect(isNonNegativeDecimal("0")).toBe(true);
    expect(isNonNegativeDecimal("73")).toBe(true);
    expect(isNonNegativeDecimal("190.50")).toBe(true);
    expect(isNonNegativeDecimal("  100  ")).toBe(true);
  });

  it("rejects empty, negative, or malformed input", () => {
    expect(isNonNegativeDecimal("")).toBe(false);
    expect(isNonNegativeDecimal("-5")).toBe(false);
    expect(isNonNegativeDecimal("1.2.3")).toBe(false);
    expect(isNonNegativeDecimal("abc")).toBe(false);
    expect(isNonNegativeDecimal(".5")).toBe(false);
  });
});

describe("maxEtbForBalance", () => {
  it("computes balance × rate floored to 2dp", () => {
    // The reported scenario: 73 USDT at 190 ETB → 13,870 ETB cap.
    expect(maxEtbForBalance("73", "190")).toBe("13870");
    expect(maxEtbForBalance("73", "190.00")).toBe("13870");
  });

  it("floors fractional micros to 2 decimals", () => {
    // 1.005 × 100.005 = 100.505025 → floored to 100.50
    expect(maxEtbForBalance("1.005", "100.005")).toBe("100.50");
  });

  it("handles a zero balance", () => {
    expect(maxEtbForBalance("0", "190")).toBe("0");
  });

  it("keeps exact 2dp fractions", () => {
    expect(maxEtbForBalance("2.5", "4")).toBe("10");
    expect(maxEtbForBalance("2.5", "4.2")).toBe("10.50");
  });
});

describe("sellMaxExceedsBalance", () => {
  it("flags a max above what the balance funds", () => {
    // 100,000 ETB max on 73 USDT at 190 → cap 13,870, so it exceeds.
    expect(sellMaxExceedsBalance("100000", "73", "190")).toBe(true);
  });

  it("allows a max at exactly the cap", () => {
    expect(sellMaxExceedsBalance("13870", "73", "190")).toBe(false);
  });

  it("allows a max below the cap", () => {
    expect(sellMaxExceedsBalance("10000", "73", "190")).toBe(false);
  });

  it("flags one micro over the cap", () => {
    expect(sellMaxExceedsBalance("13870.01", "73", "190")).toBe(true);
  });

  it("is exact across differing decimal scales", () => {
    expect(sellMaxExceedsBalance("100.50", "1.005", "100.005")).toBe(false);
    expect(sellMaxExceedsBalance("100.51", "1.005", "100.005")).toBe(true);
  });
});
