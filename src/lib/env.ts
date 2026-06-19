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

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

/**
 * An optional secret that may also be present-but-blank in a .env file. A
 * placeholder line like `TRON_API_KEY=` yields an empty string, not `undefined`,
 * so a plain `.optional()` would still trip `.min(1)`. We normalize "" → undefined
 * first so blank placeholders are treated as unset.
 */
const optionalSecret = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().min(1).optional(),
);

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
});

function format(error: z.ZodError): string {
  return error.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}

const publicParsed = publicSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
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
  });
  if (!parsed.success) {
    throw new Error(
      `Invalid server environment variables:\n${format(parsed.error)}`,
    );
  }
  return parsed.data;
}
