import { z } from "zod";

/**
 * Environment validation. Fails loudly at startup rather than letting a missing
 * key surface as a confusing runtime error deep inside an escrow operation.
 *
 * Two surfaces:
 *  - publicEnv: NEXT_PUBLIC_* values safe to ship to the browser.
 *  - serverEnv: secrets that must NEVER reach the client bundle. Accessing this
 *    from client code throws (see guard below).
 */

/**
 * An optional value that may also be present-but-blank in a .env file. A
 * placeholder line like `TRON_API_KEY=` yields an empty string, not `undefined`,
 * so a plain `.optional()` would still trip `.min(1)`. We normalize "" → undefined
 * first so blank placeholders are treated as unset. Used for both optional
 * server secrets and optional public values.
 */
const optionalSecret = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().min(1).optional(),
);

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  // Telegram bot username (without the @) backing the Login Widget. Optional:
  // when unset, the Telegram sign-in button simply doesn't render and the app
  // runs on email/password only.
  NEXT_PUBLIC_TELEGRAM_BOT_USERNAME: optionalSecret,
  // Numeric Telegram bot id (the integer BEFORE the colon in the BotFather
  // token, e.g. "123456789" from "123456789:AA…"). Public — it drives the
  // programmatic Login Widget popup. Optional: the "Continue with Telegram"
  // button still renders for visual parity, but clicking it without this set
  // bounces to /login?error=telegram_unconfigured.
  NEXT_PUBLIC_TELEGRAM_BOT_ID: optionalSecret,
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // Shared secret guarding the cron endpoints. Optional so local dev and the
  // build don't require it; the cron route refuses to run without it set.
  CRON_SECRET: optionalSecret,
  // ── Phase 7: Tron (TRC-20 USDT) on-chain config. All optional so the build
  // and local dev run on the stub chain provider with no real keys. The real
  // TronGrid/tronweb provider is only constructed when these are present, and
  // the HOT_WALLET_PRIVATE_KEY is read ONLY here on the server (rule #6) — it
  // must never appear in NEXT_PUBLIC_* or reach the client bundle.
  TRON_API_KEY: optionalSecret,
  TRON_HOT_WALLET_ADDRESS: optionalSecret,
  TRON_HOT_WALLET_PRIVATE_KEY: optionalSecret,
  // BIP-39 mnemonic the real provider derives per-user deposit addresses from
  // (BIP-44 Tron path m/44'/195'/0'/0/<index>). SECRET — server-side only. The
  // hot wallet controls these addresses; an operator sweeper consolidates
  // received funds to the hot wallet so withdrawals have liquidity.
  TRON_DEPOSIT_MNEMONIC: optionalSecret,
  // TRC-20 USDT contract address. Optional override; defaults per network in the
  // chain provider (mainnet USDT). Set this explicitly on a testnet whose USDT
  // contract differs from the built-in default.
  TRON_USDT_CONTRACT: optionalSecret,
  // ── Telegram auth ── Bot token from @BotFather, used SERVER-SIDE only to
  // verify the HMAC signature on Login Widget callbacks (and to derive the
  // per-user session password). Optional so the build/dev run without it; the
  // /auth/telegram route refuses to mint a session when it's unset.
  TELEGRAM_BOT_TOKEN: optionalSecret,
});

function format(error: z.ZodError): string {
  return error.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}

const publicParsed = publicSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_TELEGRAM_BOT_USERNAME:
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME,
  NEXT_PUBLIC_TELEGRAM_BOT_ID: process.env.NEXT_PUBLIC_TELEGRAM_BOT_ID,
});

if (!publicParsed.success) {
  throw new Error(
    `Invalid public environment variables:\n${format(publicParsed.error)}\n` +
      `Copy .env.example to .env.local and fill in the Supabase values.`,
  );
}

export const publicEnv = publicParsed.data;

/**
 * Validates and returns server-only secrets. Throws if called in the browser so
 * the service-role key can never be read from client code by mistake.
 */
export function getServerEnv() {
  if (typeof window !== "undefined") {
    throw new Error(
      "getServerEnv() was called in the browser. Server secrets must never " +
        "reach client code.",
    );
  }
  const parsed = serverSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
    TRON_API_KEY: process.env.TRON_API_KEY,
    TRON_HOT_WALLET_ADDRESS: process.env.TRON_HOT_WALLET_ADDRESS,
    TRON_HOT_WALLET_PRIVATE_KEY: process.env.TRON_HOT_WALLET_PRIVATE_KEY,
    TRON_DEPOSIT_MNEMONIC: process.env.TRON_DEPOSIT_MNEMONIC,
    TRON_USDT_CONTRACT: process.env.TRON_USDT_CONTRACT,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  });
  if (!parsed.success) {
    throw new Error(
      `Invalid server environment variables:\n${format(parsed.error)}`,
    );
  }
  return parsed.data;
}

/**
 * Is the real Tron chain provider fully configured? LIVE mode requires the API
 * key, the hot wallet (address + signing key), and the deposit-address mnemonic.
 * Used to (a) refuse to flip live payments on until the secrets exist and (b)
 * pick the real provider over the stub. Server-only.
 */
export function isTronConfigured(): boolean {
  const env = getServerEnv();
  return Boolean(
    env.TRON_API_KEY &&
      env.TRON_HOT_WALLET_ADDRESS &&
      env.TRON_HOT_WALLET_PRIVATE_KEY &&
      env.TRON_DEPOSIT_MNEMONIC,
  );
}
