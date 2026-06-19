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
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Allow building into a separate dir (e.g. when `next dev` holds .next).
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Fail the production build on type or lint errors — money code must not ship broken.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
