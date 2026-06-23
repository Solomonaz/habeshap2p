/**
 * Exact-decimal USDT money math.
 *
 * USDT (TRC-20) has 6 decimal places. JavaScript floats cannot represent these
 * amounts exactly (0.1 + 0.2 !== 0.3), so EVERY monetary value is handled here
 * as an integer number of "micro-USDT" (1 USDT = 1_000_000 micros) using BigInt.
 * Decimal strings are the wire/storage format (Postgres numeric → string); they
 * are converted to micros at the boundary, all arithmetic is integer-exact, and
 * converted back to a string for storage/display.
 *
 * Invariant we care about most: on a release, fee + net === amount, exactly.
 * No dust is ever created or destroyed.
 */

export const USDT_SCALE = 6;
export const MICROS_PER_USDT = 1_000_000n;

/** Taker fee in basis points (1 bps = 0.01%). 25 bps = 0.25% (spec §6). */
export const TAKER_FEE_BPS = 25n;
const BPS_DENOM = 10_000n;

const DECIMAL_RE = /^\d+(\.\d+)?$/;

/**
 * Normalize a raw monetary scalar to a plain decimal string.
 *
 * Postgres `numeric` is serialized by PostgREST as a JSON *number*, not a
 * string, so supabase-js hands us a JS number even though our types say
 * `string`. We accept both here. NOTE: once a value has been parsed as a JS
 * number, precision beyond 2^53 is already lost — for balances large enough to
 * matter, the query should select the column as text (`amount::text`) so it
 * never becomes a float. For MVP-scale balances this is exact.
 */
function normalizeDecimal(amount: string | number): string {
  if (typeof amount === "number") {
    if (!Number.isFinite(amount)) {
      throw new Error(`Invalid USDT amount: ${amount}`);
    }
    return amount.toString();
  }
  return amount.trim();
}

/** Parse a non-negative decimal amount into micro-USDT. Rejects bad input loudly. */
export function toMicros(amount: string | number): bigint {
  const s = normalizeDecimal(amount);
  if (!DECIMAL_RE.test(s)) {
    throw new Error(`Invalid USDT amount: "${amount}"`);
  }
  const dotIndex = s.indexOf(".");
  const intPart = dotIndex === -1 ? s : s.slice(0, dotIndex);
  const fracPart = dotIndex === -1 ? "" : s.slice(dotIndex + 1);
  if (fracPart.length > USDT_SCALE) {
    throw new Error(
      `USDT amount "${amount}" has more than ${USDT_SCALE} decimal places`,
    );
  }
  const frac = fracPart.padEnd(USDT_SCALE, "0");
  return BigInt(intPart) * MICROS_PER_USDT + BigInt(frac);
}

/** Format micro-USDT back to a canonical decimal string (trailing zeros trimmed). */
export function fromMicros(micros: bigint): string {
  if (micros < 0n) {
    throw new Error(`Cannot format negative micro amount: ${micros}`);
  }
  const intPart = micros / MICROS_PER_USDT;
  const fracPart = micros % MICROS_PER_USDT;
  if (fracPart === 0n) return intPart.toString();
  const fracStr = fracPart
    .toString()
    .padStart(USDT_SCALE, "0")
    .replace(/0+$/, "");
  return `${intPart}.${fracStr}`;
}

/** Add two micro amounts. */
export function addMicros(a: bigint, b: bigint): bigint {
  return a + b;
}

/** Subtract b from a; throws if the result would be negative (no overdraft). */
export function subMicros(a: bigint, b: bigint): bigint {
  const result = a - b;
  if (result < 0n) {
    throw new Error(`Insufficient balance: ${a} - ${b} would be negative`);
  }
  return result;
}

/** Taker fee on an amount, rounded half-up to the nearest micro. */
export function takerFeeMicros(
  amountMicros: bigint,
  bps: bigint = TAKER_FEE_BPS,
): bigint {
  if (amountMicros < 0n) throw new Error("amount must be non-negative");
  if (bps < 0n) throw new Error("bps must be non-negative");
  // half-up rounding: add half the denominator before integer division
  return (amountMicros * bps + BPS_DENOM / 2n) / BPS_DENOM;
}

/**
 * Taker fee with the admin-configured [min, max] clamp applied, in micros.
 * Mirrors the SQL in migration 0020's `order_release` exactly: percentage fee
 * (half-up), floored at `minMicros`, capped at `maxMicros` (null = no cap), and
 * never allowed to exceed the trade amount itself. Use for UI previews so the
 * displayed fee matches what the database will actually charge.
 */
export function feeMicrosClamped(
  amountMicros: bigint,
  bps: bigint,
  minMicros: bigint = 0n,
  maxMicros: bigint | null = null,
): bigint {
  if (amountMicros < 0n) throw new Error("amount must be non-negative");
  if (bps < 0n) throw new Error("bps must be non-negative");
  if (minMicros < 0n) throw new Error("min fee must be non-negative");
  let fee = takerFeeMicros(amountMicros, bps);
  if (fee < minMicros) fee = minMicros;
  if (maxMicros !== null && fee > maxMicros) fee = maxMicros;
  if (fee > amountMicros) fee = amountMicros;
  return fee;
}

/**
 * Split a release amount into the platform fee and the net the buyer receives.
 * Guarantees feeMicros + netMicros === amountMicros (conservation).
 */
export function splitRelease(
  amountMicros: bigint,
  bps: bigint = TAKER_FEE_BPS,
): { feeMicros: bigint; netMicros: bigint } {
  if (amountMicros <= 0n) throw new Error("release amount must be positive");
  const feeMicros = takerFeeMicros(amountMicros, bps);
  const netMicros = amountMicros - feeMicros;
  if (netMicros < 0n) throw new Error("fee exceeds amount");
  return { feeMicros, netMicros };
}

/** Convenience: fee on a decimal-string amount, returned as a decimal string. */
export function takerFee(amount: string, bps: bigint = TAKER_FEE_BPS): string {
  return fromMicros(takerFeeMicros(toMicros(amount), bps));
}

/**
 * Display formatter: grouped thousands, minimum 2 decimals (up to 6). Display
 * only — never feed the result back into math.
 */
export function formatUsdt(amount: string | number): string {
  const micros = toMicros(amount);
  const intPart = micros / MICROS_PER_USDT;
  const fracPart = micros % MICROS_PER_USDT;
  const intStr = intPart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fracTrimmed = fracPart
    .toString()
    .padStart(USDT_SCALE, "0")
    .replace(/0+$/, "");
  const fracStr =
    fracTrimmed.length < 2 ? fracTrimmed.padEnd(2, "0") : fracTrimmed;
  return `${intStr}.${fracStr}`;
}
