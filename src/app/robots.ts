import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * robots.txt. Public marketing/auth pages are crawlable; the whole authenticated
 * app (and the API) is off-limits — those routes redirect to /login and hold no
 * indexable content, so keeping crawlers out focuses the crawl budget on what
 * matters and avoids surfacing account URLs.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/dashboard",
        "/orders",
        "/market",
        "/verify",
        "/api/",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
