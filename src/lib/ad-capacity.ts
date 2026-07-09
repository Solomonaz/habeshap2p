/**
 * SELL-ad funding checks: a SELL ad offers to deliver USDT, and every order
 * taken against it locks the seller's USDT in escrow. So the ad's maximum order
 * (in ETB) must never advertise more USDT than the seller actually holds —
 * otherwise a buyer could open an order the seller can't fund.
 *
 * The binding rule, in USDT terms: maxOrderUsdt = max_etb / rate must be ≤ the
 * seller's available USDT. Equivalently, cross-multiplied to stay float-free:
 *   max_etb ≤ available_usdt × rate_etb.
 *
 * All math is exact BigInt on the decimal mantissas (no JS floats), so the
 * server and the client agree to the last micro.
 */

/** Parse a non-negative decimal string into an integer mantissa + its scale. */
function parseDecimal(s: string | number): { mantissa: bigint; scale: number } {
  const str = String(s).trim();
  const m = str.match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) throw new Error(`invalid decimal: "${s}"`);
  const frac = m[2] ?? "";
  return { mantissa: BigInt(m[1] + frac), scale: frac.length };
}

/** True iff `s` is a well-formed non-negative decimal (for guarding live input). */
export function isNonNegativeDecimal(s: string): boolean {
  return /^\d+(\.\d+)?$/.test(s.trim());
}

/**
 * The largest order value (ETB) a SELL ad may advertise for a seller holding
 * `availableUsdt` at `rateEtb`: floor(available × rate) at 2 decimal places.
 * Returned as a plain decimal string.
 */
export function maxEtbForBalance(
  availableUsdt: string | number,
  rateEtb: string | number,
): string {
  const a = parseDecimal(availableUsdt);
  const r = parseDecimal(rateEtb);
  const prod = a.mantissa * r.mantissa; // value × 10^(a.scale + r.scale)
  const prodScale = a.scale + r.scale;
  // Floor to 2 dp.
  const scaled2 =
    prodScale >= 2
      ? prod / 10n ** BigInt(prodScale - 2)
      : prod * 10n ** BigInt(2 - prodScale);
  const intPart = scaled2 / 100n;
  const frac = scaled2 % 100n;
  return frac === 0n
    ? intPart.toString()
    : `${intPart}.${frac.toString().padStart(2, "0")}`;
}

/**
 * True when a SELL ad's max order (ETB) exceeds what the seller's available
 * USDT can fund at the given rate, i.e. max_etb > available_usdt × rate_etb.
 * Exact integer comparison.
 */
export function sellMaxExceedsBalance(
  maxEtb: string | number,
  availableUsdt: string | number,
  rateEtb: string | number,
): boolean {
  const mx = parseDecimal(maxEtb);
  const a = parseDecimal(availableUsdt);
  const r = parseDecimal(rateEtb);
  // max_etb > avail × rate  ⇔  mx · 10^(a.scale+r.scale) > a · r · 10^(mx.scale)
  const lhs = mx.mantissa * 10n ** BigInt(a.scale + r.scale);
  const rhs = a.mantissa * r.mantissa * 10n ** BigInt(mx.scale);
  return lhs > rhs;
}

/**
 * Can the seller's available USDT cover at least this SELL ad's MINIMUM order?
 * If not, the ad can't produce a single valid order right now — it's effectively
 * out of liquidity. (min_etb ≤ available × rate ⇔ NOT min_etb > available × rate.)
 */
export function sellFundsCoverMin(
  minEtb: string | number,
  availableUsdt: string | number,
  rateEtb: string | number,
): boolean {
  return !sellMaxExceedsBalance(minEtb, availableUsdt, rateEtb);
}

/**
 * A SELL ad's LIVE max order (ETB): the lesser of its configured max and what the
 * seller's balance can actually fund at the rate — mirrors the SQL
 * `least(max_etb, trunc(available × rate, 2))` in migration 0059. Returned as a
 * plain decimal string. Used as a fail-open client fallback when the capacity RPC
 * is unavailable; the RPC value is authoritative when present.
 */
export function effectiveMaxEtb(
  maxEtb: string | number,
  availableUsdt: string | number,
  rateEtb: string | number,
): string {
  return sellMaxExceedsBalance(maxEtb, availableUsdt, rateEtb)
    ? maxEtbForBalance(availableUsdt, rateEtb)
    : String(maxEtb).trim();
}
