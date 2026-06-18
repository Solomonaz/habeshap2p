import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HabeshaP2P — USDT / ETB Exchange",
  description:
    "Peer-to-peer USDT ↔ ETB escrow exchange for the Ethiopian diaspora.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      {/* suppressHydrationWarning: browser extensions (Grammarly, etc.) inject
          attributes like data-gr-ext-installed onto <body> after SSR, which
          otherwise trips React's hydration check. Scoped to this one element. */}
      <body className="min-h-screen" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
