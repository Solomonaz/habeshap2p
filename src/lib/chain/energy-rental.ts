import "server-only";
import { getServerEnv } from "@/lib/env";

/**
 * Energy-rental client (Phase 9 — the "rental"/lending sweep strategy).
 *
 * In rental mode the sweeper rents Energy to a per-user deposit address for the
 * few seconds it needs to forward USDT to the hot wallet, instead of sending TRX
 * that gets burned. There is no universal on-chain rental API, so this is a small
 * PLUGGABLE HTTP adapter: point ENERGY_RENTAL_API_URL / ENERGY_RENTAL_API_KEY at
 * a provider (iTRX, feee.io, tronenergy.market, …) that exposes a "rent energy to
 * an address" endpoint.
 *
 * Contract: POST <url> with { address, energy } and a Bearer key; a 2xx means the
 * rental was placed. The exact request/response shape varies by provider — adjust
 * `rentEnergy` to match the one you contract with. When the env isn't configured
 * this throws `EnergyRentalUnavailable`, so the sweeper degrades to SKIPPING the
 * address (it must NEVER fall back to burning TRX — rule from the design).
 */

/** Thrown when rental is requested but the provider isn't configured/reachable. */
export class EnergyRentalUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnergyRentalUnavailable";
  }
}

export type EnergyRentalResult = {
  /** Provider order/transaction reference, if it returns one. */
  reference?: string;
};

/** Is the rental provider configured (both URL + key present)? */
export function isEnergyRentalConfigured(): boolean {
  const env = getServerEnv();
  return Boolean(env.ENERGY_RENTAL_API_URL && env.ENERGY_RENTAL_API_KEY);
}

/**
 * Rent `energy` units of Energy to `address` for a short duration. Throws
 * EnergyRentalUnavailable when unconfigured or on any non-2xx / network error, so
 * the caller can cleanly fall back to "skip + alert" rather than burning TRX.
 */
export async function rentEnergy(
  address: string,
  energy: number,
): Promise<EnergyRentalResult> {
  const env = getServerEnv();
  if (!env.ENERGY_RENTAL_API_URL || !env.ENERGY_RENTAL_API_KEY) {
    throw new EnergyRentalUnavailable(
      "Energy rental is not configured. Set ENERGY_RENTAL_API_URL and " +
        "ENERGY_RENTAL_API_KEY, or switch the sweep strategy off 'rental'.",
    );
  }

  let res: Response;
  try {
    res = await fetch(env.ENERGY_RENTAL_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.ENERGY_RENTAL_API_KEY}`,
      },
      body: JSON.stringify({ address, energy }),
      cache: "no-store",
    });
  } catch (err) {
    throw new EnergyRentalUnavailable(
      `Energy rental request failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new EnergyRentalUnavailable(
      `Energy rental provider returned HTTP ${res.status}${
        detail ? `: ${detail.slice(0, 200)}` : ""
      }`,
    );
  }

  const body = (await res.json().catch(() => ({}))) as {
    reference?: string;
    order_id?: string;
    id?: string;
  };
  return { reference: body.reference ?? body.order_id ?? body.id };
}
