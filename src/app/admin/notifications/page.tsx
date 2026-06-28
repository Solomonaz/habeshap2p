import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { fetchNotifications } from "@/lib/notifications";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminNotificationsPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) redirect("/market");

  const notifications = await fetchNotifications(supabase, user.id, 50);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            System alerts, dispute notifications, and platform activity updates.
          </p>
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-paper-border bg-paper-raised/40 py-14 text-center text-sm text-ink-muted">
          No notifications recorded yet.
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {notifications.map((n) => {
            const isUnread = !n.read_at;
            return (
              <li
                key={n.id}
                className={
                  "rounded-xl border p-4 transition-colors " +
                  (isUnread
                    ? "border-amber/40 bg-amber-wash/30"
                    : "border-paper-border bg-paper-raised")
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-ink">
                        {n.title}
                      </span>
                      {isUnread && (
                        <span className="rounded-full bg-amber px-2 py-0.5 text-[10px] font-bold text-paper uppercase tracking-wider">
                          New
                        </span>
                      )}
                    </div>
                    {n.body && (
                      <p className="mt-1 text-xs text-ink-soft">{n.body}</p>
                    )}
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-faint">
                      <span>{new Date(n.created_at).toLocaleString()}</span>
                      {n.audience === "admin" && (
                        <span className="rounded bg-paper-sunken px-1.5 py-0.5 font-semibold text-ink-muted uppercase">
                          Admin Alert
                        </span>
                      )}
                    </div>
                  </div>
                  {n.href && (
                    <Link
                      href={n.href}
                      className="shrink-0 rounded-md bg-paper border border-paper-border px-3 py-1.5 text-xs font-semibold text-ink hover:bg-paper-sunken"
                    >
                      View details →
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
