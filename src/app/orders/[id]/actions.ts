"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { markPaid, release, cancel } from "@/lib/orders";
import { openDispute } from "@/lib/disputes";

const schema = z.object({
  orderId: z.string().uuid(),
  intent: z.enum(["paid", "release", "cancel", "dispute"]),
  reason: z.string().trim().min(1).max(1000).optional(),
});

export type OrderActionState = { error?: string };

/**
 * Single entry point for the buyer/seller order controls. The authenticated
 * user is passed as the actor; the SQL functions re-verify that the actor is the
 * correct party for the requested transition (rule #1: only the seller can
 * release). We never trust the client to say who it is.
 */
export async function runOrderAction(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const parsed = schema.safeParse({
    orderId: formData.get("orderId"),
    intent: formData.get("intent"),
    reason: formData.get("reason") ?? undefined,
  });
  if (!parsed.success) return { error: "Invalid request" };
  if (parsed.data.intent === "dispute" && !parsed.data.reason) {
    return { error: "Describe the problem so an admin can review it." };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  try {
    switch (parsed.data.intent) {
      case "paid":
        await markPaid(parsed.data.orderId, user.id);
        break;
      case "release":
        await release(parsed.data.orderId, user.id);
        break;
      case "cancel":
        await cancel(parsed.data.orderId, user.id);
        break;
      case "dispute":
        await openDispute({
          orderId: parsed.data.orderId,
          actorId: user.id,
          reason: parsed.data.reason!,
        });
        break;
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Action failed" };
  }

  revalidatePath(`/orders/${parsed.data.orderId}`);
  return {};
}
