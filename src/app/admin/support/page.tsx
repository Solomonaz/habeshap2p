import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { fetchAdminSupportThreads } from "@/lib/support";
import { traderName } from "@/lib/handle";

export const dynamic = "force-dynamic";

/** The support inbox: one row per trader who has messaged, newest first. */
export default async function AdminSupportPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) redirect("/market");

  const threads = await fetchAdminSupportThreads();

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-2xl font-bold tracking-tight text-ink">Support inbox</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Conversations from traders. Newest activity first; a red badge means unread
        messages waiting for a reply.
      </p>

      {threads.length === 0 ? (
        <p className="mt-8 rounded-card border border-paper-border bg-paper-raised px-4 py-10 text-center text-sm text-ink-muted">
          No support conversations yet.
        </p>
      ) : (
        <ul className="mt-6 space-y-2">
          {threads.map((t) => {
            const name = traderName(t.full_name, t.user_id);
            return (
              <li key={t.user_id}>
                <Link
                  href={`/admin/support/${t.user_id}`}
                  className="flex items-center gap-3 rounded-card border border-paper-border bg-paper-raised px-4 py-3 transition-colors hover:border-ink-faint/50 hover:bg-paper-sunken/50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-sunken text-sm font-bold text-ink-soft">
                    {name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-ink">
                        {name}
                        {t.public_id && (
                          <span className="ml-1.5 font-amount text-xs font-normal text-ink-faint">
                            #{t.public_id}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-[11px] text-ink-faint">
                        {new Date(t.last_at).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink-muted">
                      {t.last_from_admin && (
                        <span className="text-ink-faint">You: </span>
                      )}
                      {t.last_body}
                    </p>
                  </div>
                  {t.unread > 0 && (
                    <span className="shrink-0 rounded-full bg-sell px-2 py-0.5 text-[10px] font-bold text-white">
                      {t.unread > 9 ? "9+" : t.unread}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
