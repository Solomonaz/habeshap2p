import { redirect } from "next/navigation";

// The admin console opens on the Ops overview (the main financial dashboard).
// Disputes moved to /admin/disputes.
export default function AdminHome() {
  redirect("/admin/overview");
}
