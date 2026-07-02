import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * sitemap.xml — the publicly indexable pages only (the app itself is behind auth
 * and disallowed in robots). As public content pages (guides, FAQ) are added,
 * list them here.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/signup`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/login`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
  ];
}
