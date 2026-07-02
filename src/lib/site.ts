/**
 * Canonical site metadata, shared by the root layout, sitemap, robots, manifest,
 * OG image, and JSON-LD so the brand/URL live in one place. Override the URL per
 * environment with NEXT_PUBLIC_SITE_URL (e.g. a preview deploy); defaults to prod.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://www.habeshap2p.online"
).replace(/\/$/, "");

export const SITE_NAME = "HabeshaP2P";

export const SITE_TITLE =
  "HabeshaP2P — Buy & Sell USDT for Ethiopian Birr (ETB)";

export const SITE_DESCRIPTION =
  "Peer-to-peer USDT ↔ ETB exchange for the Ethiopian diaspora. The crypto side " +
  "is held in escrow and never auto-released; Birr settles directly between " +
  "traders over Telebirr and Ethiopian banks (CBE, Abyssinia, Awash, Dashen).";

export const SITE_KEYWORDS = [
  "USDT to ETB",
  "buy USDT Ethiopia",
  "sell USDT Ethiopian birr",
  "P2P crypto exchange Ethiopia",
  "Telebirr USDT",
  "USDT Birr exchange",
  "Ethiopian diaspora crypto",
  "HabeshaP2P",
];
