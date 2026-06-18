/**
 * Display formatters for ETB (the fiat side). ETB never touches escrow, so
 * unlike USDT it is fine to format via Number for display only — never use these
 * results for arithmetic.
 */

export function formatEtb(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Exchange rate: ETB per 1 USDT. Allows up to 4 decimals. */
export function formatRate(rate: string): string {
  const n = Number(rate);
  if (!Number.isFinite(n)) return rate;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(n);
}
