import type { PaymentMethod, AdSide } from "@/types/domain";

/** Human labels for the whitelisted payment rails. */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  TELEBIRR: "Telebirr",
  CBE: "CBE",
  ABYSSINIA: "Bank of Abyssinia",
  AWASH: "Awash Bank",
  DASHEN: "Dashen Bank",
};

/**
 * Accent colour for each rail's chip bar (Binance shows a coloured tab beside
 * each method). Only irreversible rails are whitelisted (rule #3).
 */
export const PAYMENT_METHOD_COLOR: Record<PaymentMethod, string> = {
  TELEBIRR: "#0ecb81",
  CBE: "#8b5cf6",
  ABYSSINIA: "#f6465d",
  AWASH: "#f0b90b",
  DASHEN: "#3b82f6",
};

/** Ad side described from the advertiser's perspective. */
export const SIDE_LABELS: Record<AdSide, string> = {
  SELL: "Selling USDT",
  BUY: "Buying USDT",
};

/** Short badge label for the order-book row. */
export const SIDE_BADGE: Record<AdSide, string> = {
  SELL: "SELLS",
  BUY: "BUYS",
};
