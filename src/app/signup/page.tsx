import type { Metadata } from "next";
import { SignupForm } from "./signup-form";
import { AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = {
  title: "Create your account",
  description:
    "Create a free HabeshaP2P account to buy and sell USDT for Ethiopian birr (ETB). Crypto is held in escrow — never auto-released.",
  alternates: { canonical: "/signup" },
};

export default function SignupPage() {
  return (
    <AuthShell>
      <SignupForm />
    </AuthShell>
  );
}
