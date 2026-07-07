import {
  isWalletMethod,
  type PaymentMethod,
  type AdSide,
} from "@/types/domain";

/**
 * Label for the account-identifier field of a rail: mobile wallets use a phone
 * number, banks use an account number.
 */
export function accountNumberLabel(method: PaymentMethod): string {
  return isWalletMethod(method) ? "Phone number" : "Bank account number";
}

/** Placeholder mirroring accountNumberLabel. */
export function accountNumberPlaceholder(method: PaymentMethod): string {
  return isWalletMethod(method)
    ? "Phone number (e.g. 09xxxxxxxx)"
    : "Bank account number";
}

/** Human labels for the whitelisted payment rails. */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  TELEBIRR: "Telebirr",
  MPESA: "M-Pesa",
  CBE_BIRR: "CBE Birr",
  CBE: "Commercial Bank of Ethiopia",
  AWASH: "Awash Bank",
  DASHEN: "Dashen Bank",
  ABYSSINIA: "Bank of Abyssinia",
  WEGAGEN: "Wegagen Bank",
  HIBRET: "Hibret Bank (United)",
  NIB: "Nib International Bank",
  ZEMEN: "Zemen Bank",
  BUNNA: "Bunna Bank",
  OROMIA: "Oromia Bank",
  COOP_OROMIA: "Cooperative Bank of Oromia",
};

/**
 * Accent colour for each rail's chip bar (Binance shows a coloured tab beside
 * each method). Only irreversible rails are whitelisted (rule #3).
 */
export const PAYMENT_METHOD_COLOR: Record<PaymentMethod, string> = {
  TELEBIRR: "#0ecb81",
  MPESA: "#e11d48",
  CBE_BIRR: "#7c3aed",
  CBE: "#8b5cf6",
  AWASH: "#f0b90b",
  DASHEN: "#3b82f6",
  ABYSSINIA: "#f6465d",
  WEGAGEN: "#0891b2",
  HIBRET: "#16a34a",
  NIB: "#ea580c",
  ZEMEN: "#0d9488",
  BUNNA: "#a16207",
  OROMIA: "#4f46e5",
  COOP_OROMIA: "#65a30d",
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
