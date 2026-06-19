import type { NextConfig } from "next";

/**
 * Security response headers applied to every route (Phase 8 hardening).
 *
 * The Content-Security-Policy is deliberately strict but allows what this app
 * actually needs: same-origin assets, inline styles (Tailwind injects a few),
 * images as data/blob (proof previews) and https (Supabase signed URLs), and
 * connections to Supabase over https/wss (REST + Realtime). `'unsafe-inline'`
 * for scripts is included because Next's hydration bootstrap uses inline
 * scripts; tightening this to a nonce is a follow-up (flagged in the README).
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  // Force HTTPS for two years, including subdomains.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    // Allow the camera for our OWN origin only — the /verify liveness selfie
    // needs getUserMedia. `camera=()` would block it everywhere (including us).
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), payment=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

/**
 * Server Actions enforce that the request's `Origin` header matches the
 * forwarded host (a CSRF guard). When you preview the dev server through a
 * tunnel (VS Code dev tunnels, etc.), the tunnel forwards `x-forwarded-host` as
 * the public tunnel host but REWRITES the `Origin` header to the upstream
 * target — `localhost:3001`. Next compares the two, sees a mismatch, and aborts
 * with "Invalid Server Actions request".
 *
 * Next checks the *Origin* value against `allowedOrigins`, so the entries must
 * be the rewritten localhost host:port (not the tunnel host). Gated to
 * development so production keeps the strict same-origin guard.
 */
const devAllowedOrigins =
  process.env.NODE_ENV !== "production"
    ? [
        "localhost:3000",
        "localhost:3001",
        "127.0.0.1:3000",
        "127.0.0.1:3001",
        // Escape hatch for any other host the tunnel reports (no port = exact host).
        ...(process.env.ALLOWED_DEV_ORIGIN
          ? [process.env.ALLOWED_DEV_ORIGIN]
          : []),
      ]
    : [];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Allow building into a separate dir (e.g. when `next dev` holds .next).
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Fail the production build on type or lint errors — money code must not ship broken.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
  experimental: {
    serverActions: { allowedOrigins: devAllowedOrigins },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
