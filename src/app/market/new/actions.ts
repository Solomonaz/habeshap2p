"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { AD_SIDES, PAYMENT_METHODS, type PaymentMethod } from "@/types/domain";
import { sellMaxExceedsBalance, maxEtbForBalance } from "@/lib/ad-capacity";
import { formatEtb } from "@/lib/format";

/** A positive decimal string with up to 2 fractional digits (ETB amounts). */
const etbAmount = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter a valid amount")
  .refine((v) => Number(v) > 0, "Must be greater than zero");

/** The price (rate) carries up to 4 decimals; ETB amounts (min/max) only 2. */
const rateEtb = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,4})?$/, "Enter a valid price")
  .refine((v) => Number(v) > 0, "Must be greater than zero");

const createAdSchema = z
  .object({
    side: z.enum(AD_SIDES),
    rate_etb: rateEtb,
    min_etb: etbAmount,
    max_etb: etbAmount,
    payment_methods: z
      .array(z.enum(PAYMENT_METHODS))
      .min(1, "Choose at least one payment method"),
    // For BUY ads the advertiser IS the buyer, so we capture the name they will
    // pay from now (rule #2) — it is copied onto each order a seller takes.
    payer_name: z.string().trim().optional(),
    // Optional free-text note shown to anyone who opens the ad (online hours,
    // payment timing, instructions). Capped to match the DB check (≤ 500).
    notes: z
      .string()
      .trim()
      .max(500, "Notes can be at most 500 characters")
      .optional(),
  })
  .refine((v) => Number(v.min_etb) <= Number(v.max_etb), {
    message: "Minimum cannot exceed maximum",
    path: ["min_etb"],
  })
  .refine((v) => v.side !== "BUY" || (v.payer_name?.length ?? 0) > 0, {
    message: "Enter the payment-account name you will pay from",
    path: ["payer_name"],
  });

/**
 * A SELL ad's per-method receiving account (migration 0052). The advertiser (the
 * USDT-seller) supplies one of these for every rail they accept; the buyer picks
 * a rail and order_create snapshots the matching account.
 */
const receivingAccountSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  name: z.string().trim().min(1, "Account holder name is required").max(120),
  number: z.string().trim().min(1, "Account number / phone is required").max(60),
  note: z.string().trim().max(200).optional().default(""),
});

export type CreateAdState = { error?: string };

export async function createAd(
  _prev: CreateAdState,
  formData: FormData,
): Promise<CreateAdState> {
  const parsed = createAdSchema.safeParse({
    side: formData.get("side"),
    rate_etb: formData.get("rate_etb"),
    min_etb: formData.get("min_etb"),
    max_etb: formData.get("max_etb"),
    payment_methods: formData.getAll("payment_methods"),
    payer_name: formData.get("payer_name") ?? undefined,
    notes: formData.get("notes") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // SELL ads carry a receiving account per method (migration 0052). Parse and
  // validate the JSON payload the form builds; each accepted method needs a
  // name + number. The methods here are the source of truth for a SELL ad's
  // payment_methods.
  let receivingAccounts:
    | { method: PaymentMethod; name: string; number: string; note: string }[]
    | null = null;
  if (parsed.data.side === "SELL") {
    let raw: unknown;
    try {
      raw = JSON.parse((formData.get("receiving_accounts") ?? "[]").toString());
    } catch {
      return { error: "Could not read the receiving accounts — please retry." };
    }
    const accts = z.array(receivingAccountSchema).safeParse(raw);
    if (!accts.success) {
      return {
        error: accts.error.issues[0]?.message ?? "Add a valid receiving account",
      };
    }
    if (accts.data.length === 0) {
      return { error: "Add at least one payment method with its account." };
    }
    const seen = new Set<string>();
    for (const a of accts.data) {
      if (seen.has(a.method)) {
        return { error: "Each payment method can only be added once." };
      }
      seen.add(a.method);
    }
    receivingAccounts = accts.data.map((a) => ({
      method: a.method,
      name: a.name,
      number: a.number,
      note: a.note ?? "",
    }));
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // One open ad per side: a user may have at most one live SELL and one live BUY
  // ad. Refuse a second on the same side while one is still open (ACTIVE/PAUSED).
  // The DB partial unique index (migration 0028) is the hard backstop; this gives
  // a friendly message instead of a raw constraint error.
  const sideWord = parsed.data.side === "SELL" ? "SELL" : "BUY";
  const { data: existingAd } = await supabase
    .from("ads")
    .select("id")
    .eq("user_id", user.id)
    .eq("side", parsed.data.side)
    .neq("status", "CLOSED")
    .maybeSingle();
  if (existingAd) {
    return {
      error:
        `You already have an open ${sideWord} ad. Close it from “My ads” ` +
        `before posting another.`,
    };
  }

  // SELL ads deliver USDT from escrow, so the advertised max order must be
  // fundable from the seller's current USDT balance. Without this, an ad could
  // advertise a max far above what the seller holds (e.g. 100,000 ETB max on a
  // 73-USDT balance), and orders against it would only fail later at escrow time.
  if (parsed.data.side === "SELL") {
    const { data: wallet } = await supabase
      .from("wallets")
      .select("usdt_available::text")
      .eq("user_id", user.id)
      .single();
    const available = wallet?.usdt_available ?? "0";
    if (
      sellMaxExceedsBalance(
        parsed.data.max_etb,
        available,
        parsed.data.rate_etb,
      )
    ) {
      const cap = maxEtbForBalance(available, parsed.data.rate_etb);
      return {
        error:
          `Your max order of ${formatEtb(parsed.data.max_etb)} ETB is more than ` +
          `your ${available} USDT balance can cover at this rate. Lower the max ` +
          `to ${formatEtb(cap)} ETB or less, or deposit more USDT.`,
      };
    }
  }

  // Insert AS THE USER. The RLS insert policy requires user_id = auth.uid(),
  // so a forged user_id would be rejected by the database, not just trusted here.
  const isSell = parsed.data.side === "SELL";
  // For a SELL ad the accepted methods are exactly those with a receiving
  // account; the legacy single receiving_* columns mirror the first account so
  // older read paths keep working alongside receiving_accounts.
  const first = receivingAccounts?.[0];
  const { error } = await supabase.from("ads").insert({
    user_id: user.id,
    side: parsed.data.side,
    rate_etb: parsed.data.rate_etb,
    min_etb: parsed.data.min_etb,
    max_etb: parsed.data.max_etb,
    payment_methods: isSell
      ? receivingAccounts!.map((a) => a.method)
      : parsed.data.payment_methods,
    payer_name: isSell ? null : parsed.data.payer_name,
    receiving_accounts: isSell ? receivingAccounts : null,
    receiving_name: isSell ? (first?.name ?? null) : null,
    receiving_number: isSell ? (first?.number ?? null) : null,
    receiving_note: isSell ? (first?.note ? first.note : null) : null,
    notes: parsed.data.notes ? parsed.data.notes : null,
    status: "ACTIVE",
  });

  if (error) {
    // Belt-and-braces for the race the pre-check above can't win: two requests
    // can both pass the SELECT and then race to INSERT. The partial unique index
    // (migration 0028) rejects the loser with 23505 — turn that raw constraint
    // error into the same friendly message instead of a scary DB string.
    if (error.code === "23505") {
      return {
        error:
          `You already have an open ${sideWord} ad. Close it from “My ads” ` +
          `before posting another.`,
      };
    }
    return { error: `Could not post ad: ${error.message}` };
  }

  redirect("/market/mine");
}
