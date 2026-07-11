import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import {
  fetchSupportThreadForAdmin,
  markSupportReadAdmin,
} from "@/lib/support";
import { traderName } from "@/lib/handle";
import { AdminSupportThread } from "./admin-support-thread";

export const dynamic = "force-dynamic";

export default async function AdminSupportThreadPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) redirect("/market");

  const { data: trader } = await supabase
    .from("users")
    .select("full_name, public_id, email, telegram_username, account_status")
    .eq("id", userId)
    .maybeSingle();
  if (!trader) notFound();

  const messages = await fetchSupportThreadForAdmin(userId);
  await markSupportReadAdmin(user.id, userId); // opening it = read

  const name = traderName(trader.full_name, userId);
  const tg = trader.telegram_username?.trim();
  const email = trader.email?.trim();
  const contact = tg
    ? `@${tg}`
    : email && !email.endsWith("@telegram.local")
      ? email
      : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <Link
        href="/admin/support"
        className="text-sm text-ink-muted hover:text-ink"
      >
        ← Support inbox
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h1 className="text-xl font-semibold text-ink">{name}</h1>
        {trader.public_id && (
          <span className="font-amount text-xs text-ink-faint">
            #{trader.public_id}
          </span>
        )}
        {trader.account_status && trader.account_status !== "ACTIVE" && (
          <span className="rounded bg-sell-wash px-1.5 py-0.5 text-[10px] font-semibold uppercase text-sell">
            {trader.account_status}
          </span>
        )}
      </div>
      {contact && <p className="mt-0.5 text-xs text-ink-faint">{contact}</p>}

      <AdminSupportThread userId={userId} initialMessages={messages} />
    </main>
  );
}
